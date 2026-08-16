import crypto from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * Submission-blocker sprint (2026-08) — self-service account deletion.
 *
 * THE RULE: a User row is never hard-deleted. It is anonymized in place.
 *
 * Why: the schema's own FK design makes a hard delete actively wrong.
 * Message.sender and ConversationParticipant.user are `onDelete: Cascade` —
 * deleting the row would delete every message this user ever sent in a
 * SHARED conversation, destroying other participants' history.
 * RecurringContributionSchedule.contributorUser, Pledge.contributorUser,
 * PtaConcernAssignee.user, OrganizationMemberStripeCustomer.user, and
 * GivingCustomer.user are `onDelete: Restrict` — a hard delete would simply
 * fail outright if the user has any live financial commitment or open
 * assignment. Every "who did this" attribution field elsewhere in the
 * schema (createdBy, sentBy, reviewedBy, uploadedBy, ...) is already
 * `onDelete: SetNull`, and AuditEvent.actorId is a plain denormalized
 * string with no FK at all — both were clearly designed around the row
 * continuing to exist. Anonymizing in place is not a compromise; it's what
 * the schema was built for.
 *
 * A user account and an organization are separate objects. Deleting the
 * former must never delete the latter, its contribution/audit/case history,
 * or any other organizational record merely because this user happened to
 * be an officer or owner of it.
 */

export class AccountDeletionError extends Error {
  readonly status: number;
  readonly code: string;
  readonly blockedByOrganizations?: { id: string; name: string }[];

  constructor(message: string, opts: { status?: number; code: string; blockedByOrganizations?: { id: string; name: string }[] }) {
    super(message);
    this.name = "AccountDeletionError";
    this.status = opts.status ?? 409;
    this.code = opts.code;
    this.blockedByOrganizations = opts.blockedByOrganizations;
  }
}

/**
 * Organizations where this user is the ONLY active ORG_OWNER. Deletion must
 * be blocked for all of them — never an automatic successor, per explicit
 * instruction. The caller must transfer ownership (promote another member
 * to ORG_OWNER, or have an existing ORG_OWNER take over) before deletion can
 * proceed for that organization's membership.
 */
export async function findSoleOwnerOrganizations(userId: string): Promise<{ id: string; name: string }[]> {
  const ownedMemberships = await prisma.organizationMembership.findMany({
    where: { userId, role: "ORG_OWNER", status: "active" },
    select: { organizationId: true, organization: { select: { name: true } } },
  });
  if (ownedMemberships.length === 0) return [];

  const blocked: { id: string; name: string }[] = [];
  for (const membership of ownedMemberships) {
    const otherOwnerCount = await prisma.organizationMembership.count({
      where: {
        organizationId: membership.organizationId,
        role: "ORG_OWNER",
        status: "active",
        userId: { not: userId },
      },
    });
    if (otherOwnerCount === 0) {
      blocked.push({ id: membership.organizationId, name: membership.organization.name });
    }
  }
  return blocked;
}

function anonymizedEmail(userId: string): string {
  return `deleted-${userId}@deleted.getunestra.com`;
}

/**
 * Deletes (anonymizes) a user's Unestra account. Idempotent: calling this a
 * second time on an already-deleted user is a safe no-op (returns
 * "ALREADY_DELETED" rather than throwing or re-anonymizing).
 *
 * Data classification (documented here so the privacy policy can describe
 * this accurately — see docs/account-deletion-data-classification.md):
 *
 * DELETE outright (pure personal/session/access data, no historical value):
 *  - OrganizationMembership rows (org access grants)
 *  - MfaChallengeToken, AccountVerificationToken (auth session artifacts)
 *  - MobileDeviceToken (push notification registrations)
 *  - SavedFilter (personal UI preferences)
 *  - PlatformAccess (this user's own platform-admin grant, if any)
 *
 * ANONYMIZE the User row itself (credentials/identity, login must become
 * permanently impossible, but the row id stays stable so every historical
 * FK reference above stays valid):
 *  - email -> deleted-{id}@deleted.getunestra.com (frees the real address
 *    for reuse; email is a required unique column, can't be null)
 *  - displayName, phone -> null
 *  - passwordHash -> random unusable value (defense in depth beyond the
 *    deletedAt login check)
 *  - mfaEnabled/mfaSecret/mfaBackupCodes/phoneVerified/emailVerified -> cleared
 *  - mobileTokenVersion -> incremented (invalidates every outstanding mobile
 *    JWT immediately, same mechanism already used for password reset)
 *  - deletedAt -> now (the actual "this account is gone" flag; checked by
 *    login and session resolution)
 *
 * UNLINK but preserve the org-owned record (roster/case data belongs to the
 * organization, not the user's login identity):
 *  - OrgMember.userId -> null, for every OrgMember row across every org
 *  - PtaHouseholdAdult.userId -> null, for every row across every org
 *
 * RETAIN untouched, permanently, attributed to the now-anonymized row id
 * (financial, audit, and case records — required for accounting, legal,
 * and organizational-history reasons, and this is exactly what the
 * onDelete: SetNull design already assumes elsewhere):
 *  - Contribution, ContributionAdjustment, ContributionStatement, Pledge,
 *    RecurringContributionSchedule, ReimbursementRequest, PaymentReport
 *  - AuditEvent (no FK to begin with — actorId/actorEmail are denormalized)
 *  - Meeting/MeetingMinutes/MeetingMotion/AttendanceRecord and every other
 *    "createdBy"/"recordedBy" attribution field (all SetNull already)
 *  - Message/ConversationParticipant (never touched at all — the row isn't
 *    deleted, so the Cascade relations never fire)
 *  - Union case records, PTA governance documents, HOA records, etc.
 */
export async function deleteUserAccount(input: {
  userId: string;
  reason?: string | null;
}): Promise<"DELETED" | "ALREADY_DELETED"> {
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, deletedAt: true } });
  if (!user) {
    // Deleting a user that doesn't exist at all is the same observable
    // outcome as deleting one that's already gone — never a distinct error
    // that could leak account existence to a caller that shouldn't know.
    return "ALREADY_DELETED";
  }
  if (user.deletedAt) return "ALREADY_DELETED";

  const blockedByOrganizations = await findSoleOwnerOrganizations(input.userId);
  if (blockedByOrganizations.length > 0) {
    throw new AccountDeletionError(
      `You're the only owner of ${blockedByOrganizations.length === 1 ? "an organization" : "organizations"} (${blockedByOrganizations.map((o) => o.name).join(", ")}). Transfer ownership to another member, or have an existing owner promote someone else, before deleting your account.`,
      { code: "SOLE_ORG_OWNER", status: 409, blockedByOrganizations }
    );
  }

  // Random, never-valid-as-a-real-hash placeholder — not derived from
  // anything guessable, and bcrypt.compare against it can never succeed for
  // any input since it isn't a bcrypt hash at all.
  const unusablePasswordHash = `deleted:${crypto.randomBytes(32).toString("hex")}`;

  await prisma.$transaction(async (tx) => {
    await tx.organizationMembership.deleteMany({ where: { userId: input.userId } });
    await tx.mfaChallengeToken.deleteMany({ where: { userId: input.userId } });
    await tx.accountVerificationToken.deleteMany({ where: { userId: input.userId } });
    await tx.mobileDeviceToken.deleteMany({ where: { userId: input.userId } });
    await tx.savedFilter.deleteMany({ where: { userId: input.userId } });
    await tx.platformAccess.deleteMany({ where: { userId: input.userId } });

    await tx.orgMember.updateMany({ where: { userId: input.userId }, data: { userId: null } });
    await tx.ptaHouseholdAdult.updateMany({ where: { userId: input.userId }, data: { userId: null } });

    await tx.user.update({
      where: { id: input.userId },
      data: {
        email: anonymizedEmail(input.userId),
        displayName: null,
        phone: null,
        phoneVerified: false,
        emailVerified: false,
        passwordHash: unusablePasswordHash,
        mfaEnabled: false,
        mfaSecret: null,
        mfaBackupCodes: [],
        mobileTokenVersion: { increment: 1 },
        deletedAt: new Date(),
      },
    });
  });

  // Structured, PII-free observability line — id only, never the email or
  // any other personal field (which are gone from this row by this point
  // anyway, but the discipline matters regardless of ordering).
  console.log(JSON.stringify({ event: "ACCOUNT_DELETED", userId: input.userId, at: new Date().toISOString() }));
  return "DELETED";
}
