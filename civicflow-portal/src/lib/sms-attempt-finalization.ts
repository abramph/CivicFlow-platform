import { prisma } from "@/lib/prisma";
import { releaseSmsAllowance, type SmsAllowanceReservation } from "@/lib/sms-entitlement";

/**
 * Identity of ONE in-flight send attempt — the exactly-once authority for
 * finalizing that attempt and (on failure) returning its reserved allowance
 * unit. No schema change: the SmsMessage row's own in-flight state IS the
 * claim.
 *
 * - "initial" (sendMemberSms): the row was created QUEUED by this very
 *   request and only this request advances it, so `status = QUEUED` is the
 *   one-time transition condition. (The admin Cancel action also consumes
 *   QUEUED — if it wins the race, this attempt's finalizer matches zero
 *   rows and deliberately does nothing.)
 * - "retry" (sms-queue): the claimant CAS put the row into SENDING with the
 *   lease expiry stored in nextRetryAt; `status = SENDING AND nextRetryAt =
 *   <this worker's exact lease value>` fences out every stale worker — a
 *   recovered attempt carries a different lease value, and a finalized row
 *   is no longer SENDING.
 */
export type SmsAttemptClaim =
  | { kind: "initial"; messageId: string }
  | { kind: "retry"; messageId: string; leaseExpiry: Date };

function inFlightWhere(claim: SmsAttemptClaim) {
  return claim.kind === "initial"
    ? { id: claim.messageId, status: "QUEUED" as const }
    : { id: claim.messageId, status: "SENDING" as const, nextRetryAt: claim.leaseExpiry };
}

/**
 * Commits a successful Twilio hand-off exactly once. Returns false when the
 * conditional transition matched zero rows — the attempt was recovered by
 * another worker, cancelled, or already terminalized (e.g. the delivery
 * webhook raced ahead to DELIVERED/FAILED); in that case NOTHING is
 * overwritten. nextRetryAt is cleared so a finished row can never look
 * lease-expired to the cron sweep.
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
 * Commits a SYNCHRONOUS attempt failure exactly once, and releases the
 * attempt's reserved allowance unit ONLY inside that single winning
 * transition — status change and quota release ride the same transaction,
 * so they cannot diverge into a double release. A duplicate or stale
 * finalizer (conditional update matches zero rows) returns false and
 * releases nothing: one failed attempt can return at most one unit, and can
 * never erase the unit a different successful attempt consumed in the same
 * period. Pass reservation: null for failures that never reserved
 * (authorization denials, exhausted allowance). A crash after the
 * reservation but before this commit conservatively consumes the unit —
 * the documented fail-closed tradeoff.
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
