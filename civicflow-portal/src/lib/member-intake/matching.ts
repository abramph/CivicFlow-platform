import { prisma } from "@/lib/prisma";
import { normalizeToE164 } from "@/lib/phone";

/**
 * Member Intake & Profile Update (MEMBER-QR-A) — the identity-matching
 * engine. Deliberately mirrors src/lib/imports/duplicate-matching.ts's
 * signal hierarchy (email, then phone, then name+corroborating field, name
 * never sufficient alone) rather than inventing a different one, but with
 * one important difference: that module trusts admin-supplied CSV data, so
 * an exact-email/exact-phone match there can be auto-applied. A public
 * intake submission is untrusted input from an unauthenticated person, so
 * here a CONFIDENT_MATCH only ever identifies WHO the submitter is probably
 * claiming to be -- it never by itself authorizes applying anything. That
 * authorization comes exclusively from the separate verification step
 * (verification.ts), which sends a one-time code to the TRUSTED channel
 * already on file, never the newly-submitted one. Matching = identification;
 * verification = authorization. Never conflate the two.
 *
 * §13's explicit rule: approximate/fuzzy matching never by itself produces a
 * CONFIDENT_MATCH. A name+DOB or name+address match is always, at most,
 * POSSIBLE_MATCH -- routed to admin review, never auto-linked, never
 * eligible for verification-based auto-apply.
 */

export type MatchStatus = "NO_MATCH" | "CONFIDENT_MATCH" | "POSSIBLE_MATCH" | "MULTIPLE_MATCHES";

export interface MatchResult {
  status: MatchStatus;
  /** Populated for CONFIDENT_MATCH only -- the one member this submission is
   * confidently about. */
  memberId: string | null;
  /** Populated for POSSIBLE_MATCH/MULTIPLE_MATCHES -- every candidate an
   * admin should be shown, never auto-selected between. */
  candidateMemberIds: string[];
  /** 0-100. Null for NO_MATCH. */
  confidence: number | null;
  /** Free-text explanation (e.g. "exact_email", "phone", "name+address") for
   * admin-review transparency -- never itself a security decision. */
  method: string | null;
}

export interface SubmittedIdentity {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: Date | null;
  addressLine1?: string | null;
  zipCode?: string | null;
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

function fieldsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

const CANDIDATE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  dateOfBirth: true,
  addressLine1: true,
  zipCode: true,
} as const;

/**
 * The single entry point for matching a public submission against this
 * organization's existing members. Strictly organization-scoped by
 * construction (every query below carries organizationId in its WHERE
 * clause) -- the exact same email in a different organization can never
 * surface here, by construction, not by a filter that could be forgotten.
 */
export async function matchIntakeSubmission(organizationId: string, submitted: SubmittedIdentity): Promise<MatchResult> {
  // Tier 1: exact normalized email. Multiple hits (OrgMember.email is not
  // DB-unique) is MULTIPLE_MATCHES, never a coin-flip CONFIDENT_MATCH.
  if (!isBlank(submitted.email)) {
    const normalizedEmail = submitted.email!.trim().toLowerCase();
    const matches = await prisma.orgMember.findMany({
      where: { organizationId, email: { equals: normalizedEmail, mode: "insensitive" } },
      select: CANDIDATE_SELECT,
    });
    if (matches.length === 1) {
      return { status: "CONFIDENT_MATCH", memberId: matches[0].id, candidateMemberIds: [matches[0].id], confidence: 100, method: "exact_email" };
    }
    if (matches.length > 1) {
      return { status: "MULTIPLE_MATCHES", memberId: null, candidateMemberIds: matches.map((m) => m.id), confidence: 100, method: "exact_email" };
    }
  }

  // Tier 2: exact normalized phone, digit-comparison (same idiom as
  // duplicate-matching.ts / whatsapp/phone-matching.ts). Exactly one match
  // only -- an ambiguous multi-match at this tier isn't a safe signal on
  // its own, so it falls through to tier 3 instead of guessing.
  if (!isBlank(submitted.phone)) {
    const normalizedPhone = normalizeToE164(submitted.phone!);
    if (normalizedPhone) {
      const matches = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "OrgMember"
        WHERE "organizationId" = ${organizationId}
          AND phone IS NOT NULL
          AND regexp_replace(phone, '\\D', '', 'g') = ${digitsOnly(normalizedPhone)}
      `;
      if (matches.length === 1) {
        return { status: "CONFIDENT_MATCH", memberId: matches[0].id, candidateMemberIds: [matches[0].id], confidence: 90, method: "exact_phone" };
      }
      if (matches.length > 1) {
        return { status: "MULTIPLE_MATCHES", memberId: null, candidateMemberIds: matches.map((m) => m.id), confidence: 70, method: "exact_phone" };
      }
    }
  }

  // Tier 3: name, corroborated by DOB or address/zip agreement. Never
  // sufficient alone (§13's explicit rule) -- always POSSIBLE_MATCH, never
  // CONFIDENT_MATCH, regardless of how many corroborating signals agree.
  if (!isBlank(submitted.firstName) && !isBlank(submitted.lastName)) {
    const candidates = await prisma.orgMember.findMany({
      where: {
        organizationId,
        firstName: { equals: submitted.firstName!, mode: "insensitive" },
        lastName: { equals: submitted.lastName!, mode: "insensitive" },
      },
      select: CANDIDATE_SELECT,
    });
    const corroborated = candidates.filter((candidate) => {
      const dobMatches =
        submitted.dateOfBirth != null && candidate.dateOfBirth != null && submitted.dateOfBirth.getTime() === candidate.dateOfBirth.getTime();
      const addressMatches =
        !isBlank(submitted.addressLine1) && !isBlank(candidate.addressLine1) && fieldsEqual(submitted.addressLine1, candidate.addressLine1);
      const zipMatches = !isBlank(submitted.zipCode) && !isBlank(candidate.zipCode) && fieldsEqual(submitted.zipCode, candidate.zipCode);
      return dobMatches || addressMatches || zipMatches;
    });
    if (corroborated.length === 1) {
      return { status: "POSSIBLE_MATCH", memberId: null, candidateMemberIds: [corroborated[0].id], confidence: 50, method: "name+corroborating" };
    }
    if (corroborated.length > 1) {
      return { status: "MULTIPLE_MATCHES", memberId: null, candidateMemberIds: corroborated.map((c) => c.id), confidence: 40, method: "name+corroborating" };
    }
  }

  return { status: "NO_MATCH", memberId: null, candidateMemberIds: [], confidence: null, method: null };
}
