import type { SmsMessage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reserveSmsAllowance } from "@/lib/sms-entitlement";
import {
  SMS_ATTEMPT_LEASE_MS,
  finalizeSmsAttemptFailure,
  finalizeSmsAttemptSuccess,
  finalizeSmsAttemptUnknown,
  type SmsAttemptClaim,
} from "@/lib/sms-attempt-finalization";
import { sendSms } from "@/lib/sms";
import { authorizeSmsSend } from "@/lib/sms-send-authorization";
import { resolveOrganizationAccess } from "@/lib/subscription-gate";

const BATCH_SIZE = 50;

/**
 * How long a claimed retry attempt owns its SmsMessage row before another
 * worker may recover it — the shared attempt-lease duration (see
 * SMS_ATTEMPT_LEASE_MS in lib/sms-attempt-finalization.ts for the
 * Twilio-timeout margin reasoning; initial sends use the same value via
 * claimInitialSmsAttempt).
 */
export const SMS_RETRY_LEASE_MS = SMS_ATTEMPT_LEASE_MS;

/**
 * Atomic single-owner lease over one retry attempt — the ONLY way any
 * worker (manual Retry route or the cron sweep) may take ownership of a
 * message before authorizing, reserving quota, or calling Twilio. One
 * compare-and-set UPDATE, no new columns: a due RETRYING row
 * (nextRetryAt <= now) transitions to SENDING with nextRetryAt =
 * now + SMS_RETRY_LEASE_MS. Exactly one concurrent caller can win
 * (Postgres row-locks the row for the UPDATE; losers match zero rows) —
 * so a manual retry racing the cron, or two overlapping cron invocations,
 * produce exactly one owner, one quota reservation, and one Twilio call.
 *
 * ONLY RETRYING rows are claimable — deliberately (Round 6). An expired
 * SENDING lease is NOT a license to send again: the dead worker may have
 * already reached Twilio and crashed before recording the outcome, and
 * fencing can stop a stale database write but not a duplicate external
 * text. Expired SENDING rows are parked as outcome-unknown by
 * parkExpiredSmsAttempt below instead, and parked rows (SENDING with
 * nextRetryAt NULL) match nothing here ever — manual reconciliation only.
 * retryCount increments HERE, once per won claim — never per competing
 * request, and never for the original initial claim
 * (claimInitialSmsAttempt keeps it at zero).
 *
 * The returned claim's leaseExpiry is the fencing token: finalization
 * requires `status = SENDING AND nextRetryAt = <exact lease value>`, so a
 * stale worker's finalize matches zero rows once the row was parked or
 * terminalized and can neither overwrite that state nor release quota it
 * no longer owns.
 *
 * `leaseMs` is overridable only so integration tests can mint an
 * already-expired lease without waiting out the real duration.
 */
export async function claimSmsRetryAttempt(
  messageId: string,
  leaseMs: number = SMS_RETRY_LEASE_MS
): Promise<SmsAttemptClaim | null> {
  const leaseExpiry = new Date(Date.now() + leaseMs);
  const claimed = await prisma.smsMessage.updateMany({
    where: {
      id: messageId,
      status: "RETRYING",
      nextRetryAt: { lte: new Date() },
    },
    data: { status: "SENDING", nextRetryAt: leaseExpiry, retryCount: { increment: 1 } },
  });
  return claimed.count === 1 ? { messageId, leaseExpiry } : null;
}

/** Honest operator-facing reason recorded when a lease expires with the outcome unrecorded. */
export const SMS_INTERRUPTED_OUTCOME_MESSAGE =
  "Send attempt was interrupted before its outcome was recorded; delivery outcome is unknown — verify in Twilio before retrying.";

/**
 * Parks an expired in-flight attempt as OUTCOME-UNKNOWN (Round 6). A
 * SENDING row whose lease has lapsed means a worker died (or stalled past
 * its lease) somewhere between claiming and finalizing — possibly AFTER
 * Twilio accepted the message. Re-sending would risk a duplicate text, so
 * recovery is deliberately not automatic: one atomic CAS keeps
 * status = SENDING, clears the lease (nextRetryAt: null — invisible to the
 * sweep, unclaimable, un-retryable by the ordinary Retry button,
 * un-cancellable), and records the honest manual-reconciliation message.
 * It never calls Twilio, never reserves another unit, never releases the
 * unit the dead worker may have reserved (the message may have gone out),
 * and never touches retryCount. Concurrent sweep workers racing this CAS
 * are harmless: one wins, the rest match zero rows.
 *
 * Conservative tradeoff, documented deliberately: a worker that crashed
 * BEFORE its provider call also lands here, stranding its reserved unit
 * and requiring the same manual reconciliation — we accept that over any
 * chance of duplicating a text, since the row alone cannot prove which
 * side of the Twilio call the crash happened on.
 */
export async function parkExpiredSmsAttempt(messageId: string): Promise<boolean> {
  const parked = await prisma.smsMessage.updateMany({
    where: { id: messageId, status: "SENDING", nextRetryAt: { lte: new Date() } },
    data: { nextRetryAt: null, errorMessage: SMS_INTERRUPTED_OUTCOME_MESSAGE },
  });
  return parked.count === 1;
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
 * before Twilio → one fenced finalization
 * (lib/sms-attempt-finalization.ts) keyed to the provider outcome:
 *   "sent"               → success commit (consumes the reserved unit);
 *   "definitive_failure" → single FAILED commit that alone releases the
 *                          unit, in the same transaction;
 *   "unknown"            → parked for manual reconciliation (SENDING,
 *                          lease cleared): the unit stays consumed and the
 *                          row leaves every automatic path — a timeout is
 *                          not proof Twilio rejected the message, and
 *                          retrying could double-send.
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
  const claim = await claimSmsRetryAttempt(messageId);
  if (!claim) return { claimed: false };

  // Re-read AFTER winning the claim so the attempt acts on current data.
  const message = await prisma.smsMessage.findUnique({ where: { id: messageId } });
  if (!message) return { claimed: false };

  const refetch = async () => {
    const fresh = await prisma.smsMessage.findUnique({ where: { id: messageId } });
    return { claimed: true as const, message: fresh ?? message };
  };
  const failAndRefetch = async (reservation: Parameters<typeof finalizeSmsAttemptFailure>[1], reason: string) => {
    await finalizeSmsAttemptFailure(claim, reservation, reason);
    return refetch();
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
  if (result.outcome === "sent") {
    await finalizeSmsAttemptSuccess(claim, { providerMessageId: result.providerMessageId ?? null });
    return refetch();
  }
  if (result.outcome === "unknown") {
    await finalizeSmsAttemptUnknown(claim, result.reason ?? "Delivery outcome is unknown; verify in Twilio before retrying.");
    return refetch();
  }
  return failAndRefetch(reservation, result.reason ?? "Retry failed.");
}

/**
 * Sweeps in-flight candidates and routes them by what is SAFE, not just by
 * what is due:
 *
 *   RETRYING + due  → a genuine retry: individually claimed through the
 *                     same atomic claimSmsRetryAttempt CAS the manual
 *                     route uses, then executed (one owner, one
 *                     reservation, at most one Twilio call);
 *   SENDING  + due  → an expired lease: the previous worker died with the
 *                     outcome UNRECORDED, possibly after Twilio accepted —
 *                     PARKED as outcome-unknown via parkExpiredSmsAttempt,
 *                     never re-sent, never re-reserved (Round 6).
 *
 * Outcome-unknown rows (SENDING with nextRetryAt NULL) never match this
 * query — ambiguous attempts are excluded from every automatic path by
 * construction. The findMany is purely advisory candidate discovery —
 * every row is then individually claimed or parked through an atomic CAS,
 * so two overlapping sweeps (or a sweep racing a manual retry or cancel)
 * still yield exactly one actor per row; losers count as skipped.
 */
export async function processRetryableSmsMessages(): Promise<{ processed: number; parked: number }> {
  const due = await prisma.smsMessage.findMany({
    where: { status: { in: ["RETRYING", "SENDING"] }, nextRetryAt: { lte: new Date() } },
    take: BATCH_SIZE,
    select: { id: true, status: true },
  });

  let processed = 0;
  let parked = 0;
  for (const { id, status } of due) {
    if (status === "SENDING") {
      if (await parkExpiredSmsAttempt(id)) parked += 1;
      continue;
    }
    const result = await executeClaimedSmsRetry(id);
    if (result.claimed) processed += 1;
  }

  return { processed, parked };
}
