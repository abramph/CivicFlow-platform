import { prisma } from "@/lib/prisma";
import { normalizeToE164 } from "@/lib/phone";
import type { NormalizedMemberRow } from "@/lib/imports/row-normalization";

/**
 * Resumable Import Program (PR B) — the real matching hierarchy for
 * Community member imports (Phase 5). PR A's analyzeBatch() only ever did a
 * single exact-email lookup and unconditionally called it UPDATE_AVAILABLE;
 * this module replaces that with three tiers, from strongest to weakest
 * signal, and distinguishes a row that's genuinely identical to its match
 * (EXACT_DUPLICATE) from one that has real changes (UPDATE_AVAILABLE).
 * Never matches on name alone, per the spec's explicit rule.
 */

export type MatchTier = "EXACT_DUPLICATE" | "UPDATE_AVAILABLE" | "POSSIBLE_DUPLICATE" | "NEW";

export interface DuplicateMatch {
  status: MatchTier;
  matchedRecordId: string | null;
  matchConfidence: number | null;
}

export interface ExistingMemberSnapshot {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  joinDate: Date | null;
}

export const EXISTING_MEMBER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  addressLine1: true,
  city: true,
  state: true,
  zipCode: true,
  joinDate: true,
} as const;

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

function fieldsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * True only when every mapped incoming field is either blank (never counts
 * as a conflict — a blank cell means "no opinion," not "clear this field")
 * or identical to the existing record's current value. This is the exact
 * rule that separates EXACT_DUPLICATE (nothing to do, safe default SKIP)
 * from UPDATE_AVAILABLE (a real change exists, safe default REVIEW_REQUIRED).
 */
export function isExactMatch(normalized: NormalizedMemberRow, existing: ExistingMemberSnapshot): boolean {
  const stringPairs: [string | null, string | null][] = [
    [normalized.firstName, existing.firstName],
    [normalized.lastName, existing.lastName],
    [normalized.phone, existing.phone],
    [normalized.addressLine1, existing.addressLine1],
    [normalized.city, existing.city],
    [normalized.state, existing.state],
    [normalized.zipCode, existing.zipCode],
  ];
  for (const [incoming, current] of stringPairs) {
    if (isBlank(incoming)) continue;
    if (!fieldsEqual(incoming, current)) return false;
  }
  if (normalized.joinDate && existing.joinDate && normalized.joinDate.getTime() !== existing.joinDate.getTime()) {
    return false;
  }
  return true;
}

/**
 * The single entry point analyzeBatch() calls per row (after the existing
 * blank-name/invalid-email INVALID check, which happens before this is ever
 * called). Tries email, then phone, then name+corroborating-field, in that
 * order — the first tier that produces a match wins.
 */
export async function matchCommunityMemberRow(
  organizationId: string,
  normalized: NormalizedMemberRow
): Promise<DuplicateMatch> {
  if (normalized.email) {
    const existing = await prisma.orgMember.findFirst({
      where: { organizationId, email: normalized.email },
      select: EXISTING_MEMBER_SELECT,
    });
    if (existing) {
      return isExactMatch(normalized, existing)
        ? { status: "EXACT_DUPLICATE", matchedRecordId: existing.id, matchConfidence: 100 }
        : { status: "UPDATE_AVAILABLE", matchedRecordId: existing.id, matchConfidence: 100 };
    }
  }

  if (normalized.phone) {
    const normalizedPhone = normalizeToE164(normalized.phone);
    if (normalizedPhone) {
      // Same digit-normalization idiom as src/lib/whatsapp/phone-matching.ts
      // — matches regardless of how the stored phone was formatted.
      const matches = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "OrgMember"
        WHERE "organizationId" = ${organizationId}
          AND phone IS NOT NULL
          AND regexp_replace(phone, '\\D', '', 'g') = ${digitsOnly(normalizedPhone)}
      `;
      // Exactly one match only — an ambiguous multi-match at this tier
      // isn't a safe signal on its own, so it falls through to tier 3.
      if (matches.length === 1) {
        return { status: "POSSIBLE_DUPLICATE", matchedRecordId: matches[0].id, matchConfidence: 70 };
      }
    }
  }

  if (normalized.firstName && normalized.lastName) {
    const candidates = await prisma.orgMember.findMany({
      where: {
        organizationId,
        firstName: { equals: normalized.firstName, mode: "insensitive" },
        lastName: { equals: normalized.lastName, mode: "insensitive" },
      },
      select: EXISTING_MEMBER_SELECT,
    });
    for (const candidate of candidates) {
      const corroborates =
        (!isBlank(normalized.phone) && !isBlank(candidate.phone) && digitsOnly(normalized.phone!) === digitsOnly(candidate.phone!)) ||
        (!isBlank(normalized.addressLine1) && !isBlank(candidate.addressLine1) && fieldsEqual(normalized.addressLine1, candidate.addressLine1)) ||
        (!isBlank(normalized.zipCode) && !isBlank(candidate.zipCode) && fieldsEqual(normalized.zipCode, candidate.zipCode));
      if (corroborates) {
        return { status: "POSSIBLE_DUPLICATE", matchedRecordId: candidate.id, matchConfidence: 50 };
      }
    }
  }

  return { status: "NEW", matchedRecordId: null, matchConfidence: null };
}

export interface FieldComparison {
  field: string;
  label: string;
  currentValue: string | null;
  incomingValue: string | null;
  differs: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  firstName: "First Name",
  lastName: "Last Name",
  phone: "Phone",
  addressLine1: "Street Address",
  city: "City",
  state: "State",
  zipCode: "ZIP Code",
  joinDate: "Join Date",
};

function toDateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/**
 * The review UI's "current value / imported value" breakdown (Phase 11).
 * Computed fresh from the live OrgMember record every time this is called
 * — never persisted — so a batch resumed after the matched member was
 * edited elsewhere always shows the current, accurate comparison rather
 * than a stale snapshot from analysis time (Phase 9's "recheck every
 * pending row for a changed existing record" requirement, satisfied by
 * construction rather than a separate re-check step). `differs` uses the
 * exact same blank-means-no-opinion rule as isExactMatch()/
 * memberUpdateData() — a blank incoming cell is never "differing."
 */
export function computeFieldComparison(
  normalized: NormalizedMemberRow,
  existing: ExistingMemberSnapshot
): FieldComparison[] {
  const pairs: [string, string | null, string | null][] = [
    ["firstName", normalized.firstName || null, existing.firstName],
    ["lastName", normalized.lastName || null, existing.lastName],
    ["phone", normalized.phone, existing.phone],
    ["addressLine1", normalized.addressLine1, existing.addressLine1],
    ["city", normalized.city, existing.city],
    ["state", normalized.state, existing.state],
    ["zipCode", normalized.zipCode, existing.zipCode],
    ["joinDate", toDateOnly(normalized.joinDate), toDateOnly(existing.joinDate)],
  ];
  return pairs.map(([field, incomingValue, currentValue]) => ({
    field,
    label: FIELD_LABELS[field] ?? field,
    currentValue,
    incomingValue,
    differs: !isBlank(incomingValue) && !fieldsEqual(incomingValue, currentValue),
  }));
}

export interface RowWithMatchInput {
  matchedRecordId: string | null;
  normalizedData: unknown;
}

/**
 * Shared by GET /api/imports/[id] and the batch-detail server page — one
 * batched query for every matched member on the page rather than one query
 * per row, then computeFieldComparison() per row from that in-memory map.
 */
export async function attachFieldComparisons<T extends RowWithMatchInput>(
  rows: T[],
  organizationId: string
): Promise<(T & { matchedRecord: ExistingMemberSnapshot | null; fieldComparison: FieldComparison[] | null })[]> {
  const matchedIds = [...new Set(rows.map((row) => row.matchedRecordId).filter((v): v is string => v !== null))];
  const matchedMembers = matchedIds.length
    ? await prisma.orgMember.findMany({ where: { id: { in: matchedIds }, organizationId }, select: EXISTING_MEMBER_SELECT })
    : [];
  const matchedById = new Map(matchedMembers.map((member) => [member.id, member]));

  return rows.map((row) => {
    const matched = row.matchedRecordId ? (matchedById.get(row.matchedRecordId) ?? null) : null;
    const comparison = matched ? computeFieldComparison(row.normalizedData as NormalizedMemberRow, matched) : null;
    return { ...row, matchedRecord: matched, fieldComparison: comparison };
  });
}
