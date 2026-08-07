import type { ImportKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeToE164 } from "@/lib/phone";
import type { NormalizedMemberRow, NormalizedPtaHouseholdRow, NormalizedHoaPropertyRow } from "@/lib/imports/row-normalization";

/**
 * Resumable Import Program (PR B) — the real matching hierarchy for
 * Community member imports (Phase 5). PR A's analyzeBatch() only ever did a
 * single exact-email lookup and unconditionally called it UPDATE_AVAILABLE;
 * this module replaces that with three tiers, from strongest to weakest
 * signal, and distinguishes a row that's genuinely identical to its match
 * (EXACT_DUPLICATE) from one that has real changes (UPDATE_AVAILABLE).
 * Never matches on name alone, per the spec's explicit rule.
 *
 * PR C adds two sibling matchers for PTA households and HOA properties.
 * Unlike Community, both have a deterministic, DB-backed matching key
 * (PtaHousehold's own unique constraint; the same address+unit tuple
 * importHoaProperties() already dedupes on), so neither ever produces
 * POSSIBLE_DUPLICATE — only NEW/EXACT_DUPLICATE/UPDATE_AVAILABLE. They share
 * only the blank/equality primitives below with matchCommunityMemberRow(),
 * not its match logic — the fields and identity keys don't overlap.
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

// ─── PTA households ─────────────────────────────────────────────────────────

export interface PtaHouseholdSnapshot {
  id: string;
  displayName: string;
  schoolYear: string;
  notes: string | null;
  primaryContact: { name: string; email: string | null; phone: string | null } | null;
  studentNames: string[];
}

const EXISTING_PTA_HOUSEHOLD_SELECT = {
  id: true,
  displayName: true,
  schoolYear: true,
  notes: true,
  primaryContactAdultId: true,
  adults: { select: { id: true, name: true, email: true, phone: true } },
  students: { select: { displayName: true } },
} as const;

type RawPtaHouseholdSnapshot = {
  id: string;
  displayName: string;
  schoolYear: string;
  notes: string | null;
  primaryContactAdultId: string | null;
  adults: { id: string; name: string; email: string | null; phone: string | null }[];
  students: { displayName: string }[];
};

function toPtaHouseholdSnapshot(raw: RawPtaHouseholdSnapshot): PtaHouseholdSnapshot {
  const primaryAdult = raw.primaryContactAdultId ? raw.adults.find((adult) => adult.id === raw.primaryContactAdultId) : undefined;
  return {
    id: raw.id,
    displayName: raw.displayName,
    schoolYear: raw.schoolYear,
    notes: raw.notes,
    primaryContact: primaryAdult ? { name: primaryAdult.name, email: primaryAdult.email, phone: primaryAdult.phone } : null,
    studentNames: raw.students.map((s) => s.displayName),
  };
}

/**
 * Matched for idempotent re-import by the same (organizationId, displayName,
 * schoolYear) key PtaHousehold is DB-unique-constrained on — the same tuple
 * importPtaHouseholds() (vertical-import.ts) already dedupes on. A household
 * missing its primary contact (a partial prior import) is UPDATE_AVAILABLE,
 * not EXACT_DUPLICATE — mirrors that function's own "only skip if a primary
 * contact already exists" recovery logic.
 */
export async function matchPtaHouseholdRow(
  organizationId: string,
  normalized: NormalizedPtaHouseholdRow
): Promise<DuplicateMatch> {
  const existing = await prisma.ptaHousehold.findFirst({
    where: { organizationId, displayName: normalized.householdName, schoolYear: normalized.schoolYear },
    select: EXISTING_PTA_HOUSEHOLD_SELECT,
  });
  if (!existing) {
    return { status: "NEW", matchedRecordId: null, matchConfidence: null };
  }
  return existing.primaryContactAdultId
    ? { status: "EXACT_DUPLICATE", matchedRecordId: existing.id, matchConfidence: 100 }
    : { status: "UPDATE_AVAILABLE", matchedRecordId: existing.id, matchConfidence: 100 };
}

// ─── HOA properties ──────────────────────────────────────────────────────────

export interface PropertySnapshot {
  id: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  unitLabel: string | null;
  buildingLabel: string | null;
  propertyType: string;
  notes: string | null;
  owner: { firstName: string; lastName: string; email: string | null } | null;
}

const EXISTING_PROPERTY_SELECT = {
  id: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  zipCode: true,
  unitLabel: true,
  buildingLabel: true,
  propertyType: true,
  notes: true,
  residents: {
    where: { status: "ACTIVE" },
    orderBy: [{ isPrimaryContact: "desc" }, { createdAt: "asc" }],
    take: 1,
    select: { orgMember: { select: { firstName: true, lastName: true, email: true } } },
  },
} satisfies Prisma.PropertySelect;

type RawPropertySnapshot = {
  id: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  unitLabel: string | null;
  buildingLabel: string | null;
  propertyType: string;
  notes: string | null;
  residents: { orgMember: { firstName: string; lastName: string; email: string | null } }[];
};

function toPropertySnapshot(raw: RawPropertySnapshot): PropertySnapshot {
  return {
    id: raw.id,
    addressLine1: raw.addressLine1,
    addressLine2: raw.addressLine2,
    city: raw.city,
    state: raw.state,
    zipCode: raw.zipCode,
    unitLabel: raw.unitLabel,
    buildingLabel: raw.buildingLabel,
    propertyType: raw.propertyType,
    notes: raw.notes,
    owner: raw.residents[0]?.orgMember ?? null,
  };
}

/**
 * Matched for idempotent re-import by (organizationId, addressLine1,
 * unitLabel) — Property has no DB unique constraint on address (unlike
 * PtaHousehold), so this is the exact same application-level exact-string
 * match importHoaProperties() already performs. A matched property with no
 * owner fields mapped, or whose intended owner is already linked as an
 * ACTIVE resident, is EXACT_DUPLICATE; anything else with owner fields
 * present is UPDATE_AVAILABLE (there's a real owner-linking action to take).
 */
export async function matchHoaPropertyRow(
  organizationId: string,
  normalized: NormalizedHoaPropertyRow
): Promise<DuplicateMatch> {
  const existing = await prisma.property.findFirst({
    where: { organizationId, addressLine1: normalized.addressLine1, unitLabel: normalized.unitLabel },
    select: EXISTING_PROPERTY_SELECT,
  });
  if (!existing) {
    return { status: "NEW", matchedRecordId: null, matchConfidence: null };
  }

  const hasOwnerFields = Boolean(normalized.ownerFirstName || normalized.ownerLastName);
  if (!hasOwnerFields) {
    return { status: "EXACT_DUPLICATE", matchedRecordId: existing.id, matchConfidence: 100 };
  }

  if (normalized.ownerEmail) {
    // Deliberately not limited to the take:1 "primary contact" snapshot
    // above (display-only) — any ACTIVE resident with this email counts,
    // not just the one shown in the comparison table.
    const alreadyLinked = await prisma.propertyResident.findFirst({
      where: { organizationId, propertyId: existing.id, status: "ACTIVE", orgMember: { email: normalized.ownerEmail } },
      select: { id: true },
    });
    if (alreadyLinked) {
      return { status: "EXACT_DUPLICATE", matchedRecordId: existing.id, matchConfidence: 100 };
    }
  }

  return { status: "UPDATE_AVAILABLE", matchedRecordId: existing.id, matchConfidence: 100 };
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

const PTA_FIELD_LABELS: Record<string, string> = {
  contactName: "Primary Contact Name",
  contactEmail: "Primary Contact Email",
  contactPhone: "Primary Contact Phone",
  notes: "Notes",
  newStudents: "New Students to Add",
};

/**
 * PTA sibling of computeFieldComparison() — same live-computed, blank-means-
 * no-opinion rules, but compared against the household's primary contact
 * adult (a related row, not a same-table field) plus a synthetic "new
 * students to add" entry rather than a simple field diff, since students are
 * a list, not a scalar.
 */
export function computePtaHouseholdFieldComparison(normalized: NormalizedPtaHouseholdRow, existing: PtaHouseholdSnapshot): FieldComparison[] {
  const pairs: [string, string | null, string | null][] = [
    ["contactName", normalized.contactName || null, existing.primaryContact?.name ?? null],
    ["contactEmail", normalized.contactEmail, existing.primaryContact?.email ?? null],
    ["contactPhone", normalized.contactPhone, existing.primaryContact?.phone ?? null],
    ["notes", normalized.notes, existing.notes],
  ];
  const comparisons = pairs.map(([field, incomingValue, currentValue]) => ({
    field,
    label: PTA_FIELD_LABELS[field] ?? field,
    currentValue,
    incomingValue,
    differs: !isBlank(incomingValue) && !fieldsEqual(incomingValue, currentValue),
  }));

  const existingStudentNames = new Set(existing.studentNames.map((name) => name.toLowerCase().trim()));
  const newStudents = normalized.studentNames.filter((name) => !existingStudentNames.has(name.toLowerCase().trim()));
  comparisons.push({
    field: "newStudents",
    label: PTA_FIELD_LABELS.newStudents,
    currentValue: existing.studentNames.length ? existing.studentNames.join(", ") : null,
    incomingValue: newStudents.length ? newStudents.join(", ") : null,
    differs: newStudents.length > 0,
  });

  return comparisons;
}

const PROPERTY_FIELD_LABELS: Record<string, string> = {
  addressLine2: "Address Line 2",
  city: "City",
  state: "State",
  zipCode: "ZIP Code",
  buildingLabel: "Building",
  propertyType: "Property Type",
  notes: "Notes (board-only)",
  ownerName: "Owner Name",
  ownerEmail: "Owner Email",
};

/**
 * HOA sibling of computeFieldComparison() — the "owner" fields compare
 * against the property's current primary-contact (or otherwise first)
 * ACTIVE resident, mirroring the same "related row, not a same-table field"
 * shape as the PTA primary-contact comparison above.
 */
export function computeHoaPropertyFieldComparison(normalized: NormalizedHoaPropertyRow, existing: PropertySnapshot): FieldComparison[] {
  const incomingOwnerName = [normalized.ownerFirstName, normalized.ownerLastName].filter(Boolean).join(" ") || null;
  const currentOwnerName = existing.owner ? `${existing.owner.firstName} ${existing.owner.lastName}` : null;

  const pairs: [string, string | null, string | null][] = [
    ["addressLine2", normalized.addressLine2, existing.addressLine2],
    ["city", normalized.city, existing.city],
    ["state", normalized.state, existing.state],
    ["zipCode", normalized.zipCode, existing.zipCode],
    ["buildingLabel", normalized.buildingLabel, existing.buildingLabel],
    ["propertyType", normalized.propertyType, existing.propertyType],
    ["notes", normalized.notes, existing.notes],
    ["ownerName", incomingOwnerName, currentOwnerName],
    ["ownerEmail", normalized.ownerEmail, existing.owner?.email ?? null],
  ];
  return pairs.map(([field, incomingValue, currentValue]) => ({
    field,
    label: PROPERTY_FIELD_LABELS[field] ?? field,
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
 * batched query for every matched record on the page rather than one query
 * per row. Kind-aware (PR C): dispatches to the right matched-model query
 * and comparison function, but always returns the same generic shape —
 * matchedRecordLabel (a plain display string) and fieldComparison — so the
 * review UI never needs to know which kind's shape a row's match came from.
 */
export async function attachFieldComparisons<T extends RowWithMatchInput>(
  rows: T[],
  organizationId: string,
  importKind: ImportKind
): Promise<(T & { matchedRecordLabel: string | null; fieldComparison: FieldComparison[] | null })[]> {
  const matchedIds = [...new Set(rows.map((row) => row.matchedRecordId).filter((v): v is string => v !== null))];
  if (!matchedIds.length) {
    return rows.map((row) => ({ ...row, matchedRecordLabel: null, fieldComparison: null }));
  }

  if (importKind === "PTA_HOUSEHOLDS") {
    const households = await prisma.ptaHousehold.findMany({ where: { id: { in: matchedIds }, organizationId }, select: EXISTING_PTA_HOUSEHOLD_SELECT });
    const byId = new Map(households.map((h) => [h.id, toPtaHouseholdSnapshot(h)]));
    return rows.map((row) => {
      const matched = row.matchedRecordId ? (byId.get(row.matchedRecordId) ?? null) : null;
      return {
        ...row,
        matchedRecordLabel: matched ? `${matched.displayName} (${matched.schoolYear})` : null,
        fieldComparison: matched ? computePtaHouseholdFieldComparison(row.normalizedData as NormalizedPtaHouseholdRow, matched) : null,
      };
    });
  }

  if (importKind === "HOA_PROPERTIES") {
    const properties = await prisma.property.findMany({ where: { id: { in: matchedIds }, organizationId }, select: EXISTING_PROPERTY_SELECT });
    const byId = new Map(properties.map((p) => [p.id, toPropertySnapshot(p)]));
    return rows.map((row) => {
      const matched = row.matchedRecordId ? (byId.get(row.matchedRecordId) ?? null) : null;
      return {
        ...row,
        matchedRecordLabel: matched ? `${matched.addressLine1}${matched.unitLabel ? ` Unit ${matched.unitLabel}` : ""}` : null,
        fieldComparison: matched ? computeHoaPropertyFieldComparison(row.normalizedData as NormalizedHoaPropertyRow, matched) : null,
      };
    });
  }

  const matchedMembers = await prisma.orgMember.findMany({ where: { id: { in: matchedIds }, organizationId }, select: EXISTING_MEMBER_SELECT });
  const matchedById = new Map(matchedMembers.map((member) => [member.id, member]));
  return rows.map((row) => {
    const matched = row.matchedRecordId ? (matchedById.get(row.matchedRecordId) ?? null) : null;
    return {
      ...row,
      matchedRecordLabel: matched ? `${matched.firstName} ${matched.lastName}${matched.email ? ` (${matched.email})` : ""}` : null,
      fieldComparison: matched ? computeFieldComparison(row.normalizedData as NormalizedMemberRow, matched) : null,
    };
  });
}
