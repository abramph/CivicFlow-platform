import { prisma } from "@/lib/prisma";
import { releaseSmsAllowance, type SmsAllowanceReservation } from "@/lib/sms-entitlement";

/**
 * How long a claimed send attempt (initial OR retry) owns its SmsMessage
 * row before the sweep may recover it. MUST stay comfortably above the
 * Twilio HTTP timeout (TWILIO_REQUEST_TIMEOUT_MS in lib/sms.ts, 30s — 4x
 * margin, asserted in sms-queue.test.ts): a worker whose Twilio call is
 * legitimately in flight must never lose its lease and be parked as
 * outcome-unknown mid-send.
 */
export const SMS_ATTEMPT_LEASE_MS = 120_000;

/**
 * Identity of ONE in-flight send attempt — the exactly-once authority for
 * finalizing that attempt and (on definitive failure) returning its
 * reserved allowance unit. No schema change: the SmsMessage row's own
 * in-flight state IS the claim. Since Round 5, initial sends and retries
 * share ONE fencing shape: the attempt owns the row while
 * `status = SENDING AND nextRetryAt = <this worker's exact lease value>`.
 * A parked outcome-unknown row carries nextRetryAt NULL, a cancelled or
 * finalized row is no longer SENDING, a fresh RETRYING claim carries a
 * strictly later lease value, and the delivery webhook never writes nextRetryAt —
 * so every stale/duplicate finalizer matches zero rows. There is no
 * unfenced finalizer of any kind.
 */
export interface SmsAttemptClaim {
  messageId: string;
  leaseExpiry: Date;
}

function inFlightWhere(claim: SmsAttemptClaim) {
  return { id: claim.messageId, status: "SENDING" as const, nextRetryAt: claim.leaseExpiry };
}

/**
 * Atomically claims a freshly created initial-send row: QUEUED → SENDING
 * with the lease expiry stored in nextRetryAt. Exactly one winner —
 * the ONLY competitor for a QUEUED row is the admin Cancel action (the
 * campaign-level partial unique index guarantees no duplicate creator
 * exists), so a lost claim means "cancellation won": the caller must not
 * reserve quota or call Twilio. Deliberately does NOT touch retryCount —
 * the original initial attempt is attempt zero; only genuine retry claims
 * (claimSmsRetryAttempt in lib/sms-queue.ts) increment it.
 *
 * An initial SENDING row whose worker crashes is PARKED as outcome-unknown
 * by the sweep once its lease expires (parkExpiredSmsAttempt in
 * lib/sms-queue.ts) — never automatically re-sent, since the crash may
 * have happened after Twilio accepted the message.
 *
 * `leaseMs` is overridable only so integration tests can mint an
 * already-expired lease without waiting out the real duration.
 */
export async function claimInitialSmsAttempt(
  messageId: string,
  leaseMs: number = SMS_ATTEMPT_LEASE_MS
): Promise<SmsAttemptClaim | null> {
  const leaseExpiry = new Date(Date.now() + leaseMs);
  const claimed = await prisma.smsMessage.updateMany({
    where: { id: messageId, status: "QUEUED" },
    data: { status: "SENDING", nextRetryAt: leaseExpiry },
  });
  return claimed.count === 1 ? { messageId, leaseExpiry } : null;
}

/**
 * Commits a successful Twilio acceptance exactly once. Returns false when
 * the fenced transition matched zero rows — the attempt was parked as
 * outcome-unknown, cancelled, or already terminalized (e.g. the delivery
 * webhook raced ahead); in that case NOTHING is overwritten. nextRetryAt
 * is cleared so a finished row can never look lease-expired to the sweep.
 */
export async function finalizeSmsAttemptSuccess(
  claim: SmsAttemptClaim,
  outcome: { providerMessageId: string | null; costEstimateCents?: number }
): Promise<boolean> {
  const finalized = await prisma.smsMessage.updateMany({
    where: inFlightWhere(claim),
    data: {
      status: "SENT",
      sentAt: new Date(),
      providerMessageId: outcome.providerMessageId,
      errorMessage: null,
      nextRetryAt: null,
      ...(outcome.costEstimateCents !== undefined ? { costEstimateCents: outcome.costEstimateCents } : {}),
    },
  });
  return finalized.count === 1;
}

/**
 * Commits a DEFINITIVE attempt failure exactly once, and releases the
 * attempt's reserved allowance unit ONLY inside that single winning
 * transition — status change and quota release ride the same transaction,
 * so they cannot diverge into a double release. A duplicate or stale
 * finalizer (fenced update matches zero rows) returns false and releases
 * nothing: one failed attempt can return at most one unit, and can never
 * erase the unit a different successful attempt consumed in the same
 * period. Pass reservation: null for failures that never reserved
 * (authorization denials, exhausted allowance). Only for outcomes that
 * PROVE the message did not go out — ambiguous transport outcomes go
 * through finalizeSmsAttemptUnknown instead. A crash after the reservation
 * but before this commit conservatively consumes the unit — the documented
 * fail-closed tradeoff.
 */
export async function finalizeSmsAttemptFailure(
  claim: SmsAttemptClaim,
  reservation: SmsAllowanceReservation | null,
  errorMessage: string
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const finalized = await tx.smsMessage.updateMany({
      where: inFlightWhere(claim),
      data: { status: "FAILED", errorMessage, nextRetryAt: null },
    });
    if (finalized.count !== 1) return false;
    if (reservation) await releaseSmsAllowance(reservation, tx);
    return true;
  });
}

/**
 * Parks an attempt whose provider outcome is AMBIGUOUS (timeout,
 * connection reset — Twilio may have accepted the message while the
 * response was lost). Exactly once, under the same fence: the row keeps
 * status SENDING but its lease is cleared (nextRetryAt: null), which makes
 * it invisible to the cron sweep (lte-null never matches), un-retryable by
 * the ordinary Retry button (FAILED-only), and un-cancellable (the Cancel
 * CAS matches QUEUED/RETRYING only) — a deliberate manual-reconciliation
 * parking state built from existing fields, no new enum value. The
 * reserved unit is NOT released: the message may genuinely have gone out.
 * Reconciliation is a human step: verify the message in the Twilio
 * Console; a platform operator then resolves the row through a controlled
 * follow-up (documented in docs/sms-compliance-audit-2026-09.md) — never
 * an automatic retry.
 */
export async function finalizeSmsAttemptUnknown(claim: SmsAttemptClaim, errorMessage: string): Promise<boolean> {
  const finalized = await prisma.smsMessage.updateMany({
    where: inFlightWhere(claim),
    data: { errorMessage, nextRetryAt: null },
  });
  return finalized.count === 1;
}
