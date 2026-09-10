import type { SmsMessage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reserveSmsAllowance } from "@/lib/sms-entitlement";
import { finalizeSmsAttemptFailure, finalizeSmsAttemptSuccess } from "@/lib/sms-attempt-finalization";
import { sendSms } from "@/lib/sms";
import { authorizeSmsSend } from "@/lib/sms-send-authorization";
import { resolveOrganizationAccess } from "@/lib/subscription-gate";

const BATCH_SIZE = 50;

/**
 * How long a claimed retry attempt owns its SmsMessage row before another
 * worker may recover it. MUST stay comfortably above the Twilio HTTP
 * timeout (TWILIO_REQUEST_TIMEOUT_MS in lib/sms.ts, 30s — 4x margin here,
 * asserted in sms-queue.test.ts): a worker whose Twilio call is still
 * legitimately in flight must never lose its lease, or a recovery attempt
 * could double-send.
 */
export const SMS_RETRY_LEASE_MS = 120_000;

/**
 * Atomic single-owner lease over one retry attempt — the ONLY way any
 * worker (manual Retry route or the cron sweep) may take ownership of a
 * message before authorizing, reserving quota, or calling Twilio. One
 * compare-and-set UPDATE, no new columns:
 *
 *   RETRYING + nextRetryAt <= now   → normal eligible retry
 *   SENDING  + nextRetryAt <= now   → crash recovery: a previous claimant
 *                                     died mid-attempt and its lease (the
 *                                     nextRetryAt it wrote) has expired
 *
 * both transition to SENDING with nextRetryAt = now + SMS_RETRY_LEASE_MS.
 * Exactly one concurrent caller can win (Postgres row-locks the row for
 * the UPDATE; losers match zero rows) — so a manual retry racing the cron,
 * or two overlapping cron invocations, produce exactly one owner, one
 * quota reservation, and one Twilio call. While the lease is live
 * (nextRetryAt in the future) the row matches neither arm, so a second
 * worker does nothing at all. retryCount increments HERE, once per won
 * claim — never per competing request.
 *
 * The returned leaseExpiry is the fencing token: finalization requires
 * `status = SENDING AND nextRetryAt = <exact lease value>`, and a recovery
 * claim always writes a strictly later lease value (it can only happen
 * after the old value has expired), so a stale worker's finalize matches
 * zero rows and can neither overwrite the recovered attempt's result nor
 * release quota it no longer owns.
 *
 * `leaseMs` is overridable only so integration tests can mint an
 * already-expired lease without waiting out the real duration.
 */
export async function claimSmsRetryAttempt(
  messageId: string,
  leaseMs: number = SMS_RETRY_LEASE_MS
): Promise<{ leaseExpiry: Date } | null> {
  const leaseExpiry = new Date(Date.now() + leaseMs);
  const claimed = await prisma.smsMessage.updateMany({
    where: {
      id: messageId,
      status: { in: ["RETRYING", "SENDING"] },
      nextRetryAt: { lte: new Date() },
    },
    data: { status: "SENDING", nextRetryAt: leaseExpiry, retryCount: { increment: 1 } },
  });
  return claimed.count === 1 ? { leaseExpiry } : null;
}

export type ClaimedSmsRetryResult =
  | { claimed: false }
  | { claimed: true; message: SmsMessage };

/**
 * The single centralized retry executor — claim first, then act. Shared by
 * the manual admin Retry route (which first flips FAILED → RETRYING with
 * nextRetryAt = now to make the row eligible, then calls this) and the
 * cron sweep, so there is exactly one implementation of "what does a retry
 * attempt actually do" AND exactly one owner per attempt.
 *
 * Ordering, deliberately: lease ownership → billing gate → canonical send
 * authorization (fresh consent/entitlement/tenant checks, required:false —
 * see the COMPLIANCE notes below) → atomic quota reservation immediately
 * before Twilio → one-time fenced finalization
 * (lib/sms-attempt-finalization.ts), which alone may commit the outcome
 * and, on failure, release the reserved unit — exactly once, inside the
 * same transaction as the FAILED transition.
 *
 * LAUNCH-BLOCKER subscription gate: re-checked fresh on every claimed
 * attempt so the manual Retry button and the automated sweep respect it
 * identically; blocked rows are finalized FAILED (never left RETRYING) so
 * the sweep cannot retry them forever.
 *
 * COMPLIANCE gate (2026-09 audit): every claimed attempt re-runs
 * authorizeSmsSend — entitlement/add-on status, tenant-scoped member
 * identity, consent, and STOP state are re-resolved at retry time; a
 * member who texted STOP after the original failure, an org whose add-on
 * was deactivated, or a recipient whose member row was removed (memberId
 * nulled via onDelete: SetNull) is never reachable. Twilio is not called
 * for any blocked row. Retries always pass required:false — the original
 * "required" flag is not persisted, so the stricter preference rule
 * applies (fail closed).
 */
export async function executeClaimedSmsRetry(messageId: string): Promise<ClaimedSmsRetryResult> {
  const lease = await claimSmsRetryAttempt(messageId);
  if (!lease) return { claimed: false };
  const claim = { kind: "retry", messageId, leaseExpiry: lease.leaseExpiry } as const;

  // Re-read AFTER winning the claim so the attempt acts on current data.
  const message = await prisma.smsMessage.findUnique({ where: { id: messageId } });
  if (!message) return { claimed: false };

  const failAndRefetch = async (reservation: Parameters<typeof finalizeSmsAttemptFailure>[1], reason: string) => {
    await finalizeSmsAttemptFailure(claim, reservation, reason);
    const fresh = await prisma.smsMessage.findUnique({ where: { id: messageId } });
    return { claimed: true as const, message: fresh ?? message };
  };

  const access = await resolveOrganizationAccess(message.organizationId);
  if (!access.allowed) {
    return failAndRefetch(null, "Organization subscription is not active.");
  }

  const authorization = await authorizeSmsSend({
    organizationId: message.organizationId,
    memberId: message.memberId,
    phone: message.phone,
    required: false,
  });
  if (!authorization.allowed) {
    return failAndRefetch(null, authorization.reason);
  }

  const reservation = await reserveSmsAllowance(message.organizationId);
  if (!reservation) {
    return failAndRefetch(null, "Your organization has used its full monthly SMS allowance.");
  }

  const result = await sendSms({ to: authorization.normalizedPhone, body: message.body });
  if (result.sent) {
    await finalizeSmsAttemptSuccess(claim, { providerMessageId: result.providerMessageId ?? null });
    const fresh = await prisma.smsMessage.findUnique({ where: { id: messageId } });
    return { claimed: true, message: fresh ?? message };
  }
  return failAndRefetch(reservation, result.reason ?? "Retry failed.");
}

/**
 * Sweeps retry candidates: RETRYING rows whose nextRetryAt has passed
 * (normal eligibility — including a manual retry whose request died
 * between making the row eligible and claiming it) and SENDING rows whose
 * lease has expired (a claimant crashed mid-attempt; this is the
 * deliberate recovery path, and the ONLY way a second worker ever touches
 * a previously claimed attempt). The findMany is purely advisory candidate
 * discovery — every row is then individually claimed through the same
 * atomic claimSmsRetryAttempt CAS as the manual route, so two overlapping
 * sweeps (or a sweep racing a manual retry) still yield exactly one owner
 * per row; losers count as skipped, not processed.
 */
export async function processRetryableSmsMessages(): Promise<{ processed: number }> {
  const due = await prisma.smsMessage.findMany({
    where: { status: { in: ["RETRYING", "SENDING"] }, nextRetryAt: { lte: new Date() } },
    take: BATCH_SIZE,
    select: { id: true },
  });

  let processed = 0;
  for (const { id } of due) {
    const result = await executeClaimedSmsRetry(id);
    if (result.claimed) processed += 1;
  }

  return { processed };
}
