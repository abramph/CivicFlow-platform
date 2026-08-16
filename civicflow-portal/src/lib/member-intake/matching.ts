import { prisma } from "@/lib/prisma";
import { normalizeToE164 } from "@/lib/phone";

/**
 * Member Intake & Profile Update (MEMBER-QR-A, hardened in MEMBER-QR-D) --
 * the identity-matching engine. Deliberately mirrors
 * src/lib/imports/duplicate-matching.ts's signal hierarchy (email, then
 * phone, then name+corroborating field, name never sufficient alone)
 * rather than inventing a different one, but with one important
 * difference: that module trusts admin-supplied CSV data, so an
 * exact-email/exact-phone match there can be auto-applied. A public
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
 *
 * MEMBER-QR-D hardening (two real gaps found auditing A's original tier
 * design, both fixed here):
 *
 * 1. TERMINATED members are now excluded from every matching tier. A
 *    membership that was deliberately terminated (via the dedicated
 *    terminate/reinstate lifecycle -- see member-lifecycle.ts) must never
 *    be silently reachable again through a public form: not as an implicit
 *    "welcome back" reactivation, and not as a quiet contact-info edit on a
 *    closed record. A submission whose only match is a terminated member
 *    now falls through as NO_MATCH instead of CONFIDENT_MATCH, so it's
 *    routed by ordinary new-member policy (review, or a genuinely new
 *    record) rather than ever touching the terminated one. Other
 *    non-active statuses (retired/suspended/deactivated/pending) are still
 *    eligible -- those people are still legitimately reachable members who
 *    may reasonably want to update their own contact info.
 *
 * 2. Email and phone are no longer evaluated as independent short-circuit
 *    tiers where whichever resolves first wins. If a submission supplies
 *    both and they resolve to two DIFFERENT existing members, that is a
 *    genuine contradiction -- not evidence for either one -- and now
 *    produces MULTIPLE_MATCHES (routed to review) rather than a
 *    CONFIDENT_MATCH on whichever signal happened to be checked first.
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

async function findExactEmailMatches(organizationId: string, email: string): Promise<string[]> {
  const normalizedEmail = email.trim().toLowerCase();
  const matches = await prisma.orgMember.findMany({
    where: { organizationId, email: { equals: normalizedEmail, mode: "insensitive" }, membershipStatus: { not: "terminated" } },
    select: { id: true },
  });
  return matches.map((m) => m.id);
}

async function findExactPhoneMatches(organizationId: string, phone: string): Promise<string[]> {
  const normalizedPhone = normalizeToE164(phone);
  if (!normalizedPhone) return [];
  const matches = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "OrgMember"
    WHERE "organizationId" = ${organizationId}
      AND phone IS NOT NULL
      AND "membershipStatus" != 'terminated'
      AND regexp_replace(phone, '\\D', '', 'g') = ${digitsOnly(normalizedPhone)}
  `;
  return matches.map((m) => m.id);
}

/**
 * The single entry point for matching a public submission against this
 * organization's existing members. Strictly organization-scoped by
 * construction (every query below carries organizationId in its WHERE
 * clause) -- the exact same email in a different organization can never
 * surface here, by construction, not by a filter that could be forgotten.
 */
export async function matchIntakeSubmission(organizationId: string, submitted: SubmittedIdentity): Promise<MatchResult> {
  const emailProvided = !isBlank(submitted.email);
  const phoneProvided = !isBlank(submitted.phone);

  const [emailMatches, phoneMatches] = await Promise.all([
    emailProvided ? findExactEmailMatches(organizationId, submitted.email!) : Promise.resolve<string[]>([]),
    phoneProvided ? findExactPhoneMatches(organizationId, submitted.phone!) : Promise.resolve<string[]>([]),
  ]);

  // Either signal alone matching more than one member is too ambiguous to
  // use, regardless of what the other signal says.
  if (emailMatches.length > 1) {
    return { status: "MULTIPLE_MATCHES", memberId: null, candidateMemberIds: emailMatches, confidence: 100, method: "exact_email" };
  }
  if (phoneMatches.length > 1) {
    return { status: "MULTIPLE_MATCHES", memberId: null, candidateMemberIds: phoneMatches, confidence: 70, method: "exact_phone" };
  }

  const emailId = emailMatches[0] ?? null;
  const phoneId = phoneMatches[0] ?? null;

  if (emailId && phoneId) {
    if (emailId === phoneId) {
      return { status: "CONFIDENT_MATCH", memberId: emailId, candidateMemberIds: [emailId], confidence: 100, method: "exact_email+exact_phone" };
    }
    // Contradiction: email points to one member, phone to a different one.
    // Neither signal is trustworthy enough on its own to override the
    // other -- this must go to review, never a confident pick.
    return { status: "MULTIPLE_MATCHES", memberId: null, candidateMemberIds: [emailId, phoneId], confidence: 60, method: "conflicting_signals" };
  }
  if (emailId) {
    return { status: "CONFIDENT_MATCH", memberId: emailId, candidateMemberIds: [emailId], confidence: 100, method: "exact_email" };
  }
  if (phoneId) {
    return { status: "CONFIDENT_MATCH", memberId: phoneId, candidateMemberIds: [phoneId], confidence: 90, method: "exact_phone" };
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
        membershipStatus: { not: "terminated" },
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
