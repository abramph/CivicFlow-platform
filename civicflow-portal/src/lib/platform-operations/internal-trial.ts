import "server-only";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";

/**
 * Platform-admin-only internal trial grants (docs/internal-trial-grants.md).
 * Gives an existing, non-billing-exempt, non-subscribed organization 30 days
 * of application access by setting Organization.trialEndsAt — the SAME
 * field/mechanism the subscription gate (src/lib/subscription-gate.ts)
 * already reads for every organization's normal signup trial. No Stripe
 * object of any kind is created or touched anywhere in this file.
 */

export const INTERNAL_TRIAL_ERROR_CODES = [
  "INTERNAL_TRIAL_ORGANIZATION_NOT_FOUND",
  "INTERNAL_TRIAL_ORGANIZATION_INACTIVE",
  "INTERNAL_TRIAL_ALREADY_ACTIVE",
  "INTERNAL_TRIAL_ALREADY_USED",
  "INTERNAL_TRIAL_BILLING_EXEMPT",
  "INTERNAL_TRIAL_HAS_SUBSCRIPTION",
  "INTERNAL_TRIAL_REASON_REQUIRED",
  "INTERNAL_TRIAL_CONCURRENT_CONFLICT",
  "INTERNAL_TRIAL_NOT_ACTIVE",
] as const;

export type InternalTrialErrorCode = (typeof INTERNAL_TRIAL_ERROR_CODES)[number];

const STATUS_FOR_CODE: Record<InternalTrialErrorCode, number> = {
  INTERNAL_TRIAL_ORGANIZATION_NOT_FOUND: 404,
  INTERNAL_TRIAL_ORGANIZATION_INACTIVE: 409,
  INTERNAL_TRIAL_ALREADY_ACTIVE: 409,
  INTERNAL_TRIAL_ALREADY_USED: 409,
  INTERNAL_TRIAL_BILLING_EXEMPT: 409,
  INTERNAL_TRIAL_HAS_SUBSCRIPTION: 409,
  INTERNAL_TRIAL_REASON_REQUIRED: 400,
  INTERNAL_TRIAL_CONCURRENT_CONFLICT: 409,
  INTERNAL_TRIAL_NOT_ACTIVE: 409,
};

export class InternalTrialError extends Error {
  readonly code: InternalTrialErrorCode;
  readonly status: number;

  constructor(code: InternalTrialErrorCode, message: string) {
    super(message);
    this.name = "InternalTrialError";
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
  }
}

/** Fixed platform policy — never client-suppliable. Mirrors the 30-day
 * window already used for every organization's signup trial
 * (src/app/api/onboarding/organization/route.ts). */
export const INTERNAL_TRIAL_DURATION_DAYS = 30;
const INTERNAL_TRIAL_DURATION_MS = INTERNAL_TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;

export interface InternalTrialEligibility {
  organizationId: string;
  organizationName: string;
  eligible: boolean;
  ineligibleCode: InternalTrialErrorCode | null;
  ineligibleReason: string | null;
  billingExempt: boolean;
  /** Whether the org currently passes the subscription gate at all, by any
   * mechanism (billing-exempt, existing trial, or Subscription) — informational only. */
  currentAccessAllowed: boolean;
  fixedDurationDays: number;
}

/**
 * Read-only. Never mutates. Backs the admin UI's pre-confirmation panel and
 * the GET preview route — same "preview before you commit" shape as
 * previewPrimaryVerticalChange in organizations.ts.
 */
export async function checkInternalTrialEligibility(organizationId: string): Promise<InternalTrialEligibility> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, status: true, billingExempt: true, trialEndsAt: true },
  });
  if (!org) {
    throw new InternalTrialError("INTERNAL_TRIAL_ORGANIZATION_NOT_FOUND", `Organization not found: ${organizationId}`);
  }

  const subscriptionCount = await prisma.subscription.count({ where: { organizationId } });
  const now = new Date();
  const hasFutureTrial = org.trialEndsAt !== null && org.trialEndsAt.getTime() > now.getTime();

  let ineligibleCode: InternalTrialErrorCode | null = null;
  let ineligibleReason: string | null = null;

  if (org.status !== "active") {
    ineligibleCode = "INTERNAL_TRIAL_ORGANIZATION_INACTIVE";
    ineligibleReason = `Organization status is "${org.status}", not active.`;
  } else if (org.billingExempt) {
    ineligibleCode = "INTERNAL_TRIAL_BILLING_EXEMPT";
    ineligibleReason = "Organization is already billing-exempt; an internal trial is not applicable.";
  } else if (subscriptionCount > 0) {
    ineligibleCode = "INTERNAL_TRIAL_HAS_SUBSCRIPTION";
    ineligibleReason = "Organization already has a Subscription record.";
  } else if (org.trialEndsAt) {
    ineligibleCode = hasFutureTrial ? "INTERNAL_TRIAL_ALREADY_ACTIVE" : "INTERNAL_TRIAL_ALREADY_USED";
    ineligibleReason = hasFutureTrial
      ? `Organization already has an active trial ending ${org.trialEndsAt.toISOString()}.`
      : `Organization already used its one-time internal trial, which ended ${org.trialEndsAt.toISOString()}. Trials are not re-grantable.`;
  }

  return {
    organizationId: org.id,
    organizationName: org.name,
    eligible: ineligibleCode === null,
    ineligibleCode,
    ineligibleReason,
    billingExempt: org.billingExempt,
    currentAccessAllowed: org.billingExempt || hasFutureTrial || subscriptionCount > 0,
    fixedDurationDays: INTERNAL_TRIAL_DURATION_DAYS,
  };
}

export interface GrantInternalOrganizationTrialInput {
  organizationId: string;
  actorUserId: string;
  actorEmail: string;
  /** Platform role the actor held at grant time — audit-only, never used for authorization here (the caller must already have enforced requireSuperAdmin). */
  actorRole: string;
  reason: string;
  requestId?: string;
}

export interface GrantInternalOrganizationTrialResult {
  organizationId: string;
  trialStartsAt: string;
  trialExpiresAt: string;
  accessActive: boolean;
  auditEventId: string;
}

/**
 * Atomically grants a one-time, 30-day, Stripe-free internal trial.
 * Eligibility, duration, atomicity, anti-stacking, and audit are all
 * enforced HERE, not by the caller — see docs/internal-trial-grants.md.
 */
export async function grantInternalOrganizationTrial(
  input: GrantInternalOrganizationTrialInput
): Promise<GrantInternalOrganizationTrialResult> {
  const reason = input.reason.trim();
  if (!reason) {
    throw new InternalTrialError("INTERNAL_TRIAL_REASON_REQUIRED", "A reason is required to grant an internal trial.");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + INTERNAL_TRIAL_DURATION_MS);

  // The grant and its audit event commit or roll back together — an
  // organization must never receive access without a matching audit
  // record. createAuditEvent() runs through this same `tx`, so if the
  // audit insert fails for any reason (constraint violation, connection
  // drop), the whole transaction rolls back, including the trialEndsAt
  // update below. Nothing is returned to the caller until this resolves,
  // i.e. until the transaction has actually committed.
  const auditEventId = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true, status: true, billingExempt: true, trialEndsAt: true },
    });
    if (!org) {
      throw new InternalTrialError("INTERNAL_TRIAL_ORGANIZATION_NOT_FOUND", `Organization not found: ${input.organizationId}`);
    }
    if (org.status !== "active") {
      throw new InternalTrialError("INTERNAL_TRIAL_ORGANIZATION_INACTIVE", `Organization status is "${org.status}", not active.`);
    }
    if (org.billingExempt) {
      throw new InternalTrialError(
        "INTERNAL_TRIAL_BILLING_EXEMPT",
        "Organization is billing-exempt; an internal trial is not applicable."
      );
    }
    if (org.trialEndsAt) {
      const code = org.trialEndsAt.getTime() > now.getTime() ? "INTERNAL_TRIAL_ALREADY_ACTIVE" : "INTERNAL_TRIAL_ALREADY_USED";
      throw new InternalTrialError(code, "Organization has already used its one-time internal trial.");
    }

    // Recheck Subscription eligibility inside the same transaction — a real
    // subscription created between the caller's last preview and this write
    // must block the grant rather than race past it.
    const subscriptionCount = await tx.subscription.count({ where: { organizationId: input.organizationId } });
    if (subscriptionCount > 0) {
      throw new InternalTrialError("INTERNAL_TRIAL_HAS_SUBSCRIPTION", "Organization already has a Subscription record.");
    }

    // The actual anti-stacking primitive: a conditional updateMany whose
    // WHERE clause re-asserts every eligibility condition at write time, not
    // just at read time above. Two concurrent grant attempts for the same
    // org can both pass the reads above, but only one UPDATE can match
    // trialEndsAt: null — Postgres serializes the two statements against the
    // same row, and the loser's predicate no longer holds once the winner
    // commits. Same pattern as attemptClaimReportExport's atomic queue claim
    // in report-export-queue.ts.
    const result = await tx.organization.updateMany({
      where: {
        id: input.organizationId,
        trialEndsAt: null,
        billingExempt: false,
        status: "active",
      },
      data: { trialEndsAt: expiresAt },
    });

    if (result.count !== 1) {
      throw new InternalTrialError(
        "INTERNAL_TRIAL_CONCURRENT_CONFLICT",
        "Another request already granted or invalidated this trial concurrently. Please refresh and check current status."
      );
    }

    const auditEvent = await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      action: "platform.organization.internal_trial_granted",
      entityType: "organization",
      entityId: input.organizationId,
      metadata: {
        actorRole: input.actorRole,
        trialStartsAt: now.toISOString(),
        trialExpiresAt: expiresAt.toISOString(),
        durationDays: INTERNAL_TRIAL_DURATION_DAYS,
        reason,
        requestId: input.requestId ?? null,
      },
      tx,
    });

    return auditEvent.id;
  });

  return {
    organizationId: input.organizationId,
    trialStartsAt: now.toISOString(),
    trialExpiresAt: expiresAt.toISOString(),
    accessActive: true,
    auditEventId,
  };
}

export interface TerminateInternalOrganizationTrialInput {
  organizationId: string;
  actorUserId: string;
  actorEmail: string;
  actorRole: string;
  reason: string;
}

export interface TerminateInternalOrganizationTrialResult {
  organizationId: string;
  terminatedAt: string;
}

/**
 * Minimal early-termination: sets trialEndsAt to now. Never nulls it back
 * out (so the organization can never receive a second trial — the same
 * "trialEndsAt IS NULL" eligibility gate that blocks re-granting after
 * natural expiry blocks it here too, automatically, with no special-case
 * code). No extension/reset capability exists — this can only shorten an
 * already-active trial, never lengthen or restart one. Not currently wired
 * to any route or UI control (see docs/internal-trial-grants.md's recovery
 * section for the supported manual invocation path); a dedicated
 * platform-admin control is deferred as documented follow-up.
 */
export async function terminateInternalOrganizationTrialEarly(
  input: TerminateInternalOrganizationTrialInput
): Promise<TerminateInternalOrganizationTrialResult> {
  const reason = input.reason.trim();
  if (!reason) {
    throw new InternalTrialError("INTERNAL_TRIAL_REASON_REQUIRED", "A reason is required to end an internal trial early.");
  }

  const now = new Date();

  // Same commit-together guarantee as the grant path above: the
  // termination update and its audit event share one transaction, so a
  // failed audit insert rolls back the trialEndsAt change — the prior
  // trial's end time is left exactly as it was, never partially shortened.
  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: input.organizationId },
      select: { trialEndsAt: true },
    });
    if (!org) {
      throw new InternalTrialError("INTERNAL_TRIAL_ORGANIZATION_NOT_FOUND", `Organization not found: ${input.organizationId}`);
    }
    if (!org.trialEndsAt || org.trialEndsAt.getTime() <= now.getTime()) {
      throw new InternalTrialError("INTERNAL_TRIAL_NOT_ACTIVE", "Organization has no active internal trial to end.");
    }

    // Conditioned on the exact trialEndsAt value just read, mirroring the
    // grant path's anti-stacking updateMany: two concurrent termination
    // attempts can both pass the read above, but only one UPDATE can match
    // the still-current trialEndsAt — the loser gets a well-defined
    // CONCURRENT_CONFLICT rather than silently writing a second time (which
    // would otherwise create a duplicate termination audit event).
    const result = await tx.organization.updateMany({
      where: { id: input.organizationId, trialEndsAt: org.trialEndsAt },
      data: { trialEndsAt: now },
    });
    if (result.count !== 1) {
      throw new InternalTrialError(
        "INTERNAL_TRIAL_CONCURRENT_CONFLICT",
        "Trial state changed concurrently; please refresh and retry."
      );
    }

    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      action: "platform.organization.internal_trial_terminated",
      entityType: "organization",
      entityId: input.organizationId,
      metadata: { actorRole: input.actorRole, reason, terminatedAt: now.toISOString() },
      tx,
    });
  });

  return { organizationId: input.organizationId, terminatedAt: now.toISOString() };
}
