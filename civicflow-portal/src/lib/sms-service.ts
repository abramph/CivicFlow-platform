import type { SmsMessage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeToE164 } from "@/lib/phone";
import { reserveSmsAllowance } from "@/lib/sms-entitlement";
import {
  claimInitialSmsAttempt,
  finalizeSmsAttemptFailure,
  finalizeSmsAttemptSuccess,
  finalizeSmsAttemptUnknown,
} from "@/lib/sms-attempt-finalization";
import { sendSms } from "@/lib/sms";
import { authorizeSmsSend } from "@/lib/sms-send-authorization";
import { SMS_ADDON } from "@/lib/sms-pricing";

const OPT_OUT_SUFFIX = "Reply STOP to opt out.";

function withOptOutSuffix(body: string): string {
  if (body.toLowerCase().includes("stop to opt out")) return body;
  return `${body}\n\n${OPT_OUT_SUFFIX}`;
}

/**
 * Substitutes {organizationName}/{link} tokens in an SMS body, e.g.
 * "Reminder: Your {organizationName} dues are due. Open Unestra: {link}".
 * No other channel has templating today, so this stays a plain string
 * substitution rather than a general templating system.
 */
export function applySmsTemplateTokens(body: string, tokens: { organizationName: string; link?: string | null }): string {
  return body.replaceAll("{organizationName}", tokens.organizationName).replaceAll("{link}", tokens.link ?? "");
}

export interface SendMemberSmsParams {
  organizationId: string;
  /**
   * REQUIRED tenant-scoped OrgMember id. Organization messaging always
   * addresses a roster member — consent is unverifiable otherwise, so a
   * null (representable only because upstream recipient rows are nullable)
   * fails closed inside authorizeSmsSend and never reaches Twilio.
   */
  memberId: string | null;
  phone: string;
  body: string;
  campaignId?: string | null;
  sentById?: string | null;
  /**
   * Bypasses the member's own commsSmsEnabled preference toggle — reserved
   * for legally required notices, mirrors the `required` param on
   * sendPushToMember in lib/push.ts. Does NOT bypass smsOptIn or
   * smsOptedOutAt: those are consent/compliance gates, not a preference, and
   * Twilio/TCPA compliance requires them to block every message with no
   * exceptions, "required" or not.
   */
  required?: boolean;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * Creates this attempt's QUEUED SmsMessage row — or, for campaign messages,
 * resolves the ONE canonical row the partial unique index
 * (SmsMessage_org_campaign_member_attempt_key) allows per
 * (organization, campaign, member). A unique-violation loser is NOT a send
 * failure: some other invocation (a concurrent Send Now racing the cron,
 * or an earlier completed run) already owns that recipient's attempt, so
 * the loser returns the existing canonical row and must do nothing else —
 * no claim, no reservation, no Twilio. Subsequent delivery problems are
 * handled by retrying THAT row through the leased retry system, never by
 * creating another campaign message. Non-campaign transactional rows
 * (campaignId null) are outside the index and always create normally.
 */
async function createOrResolveAttemptRow(
  params: SendMemberSmsParams,
  data: { phone: string; body: string }
): Promise<{ row: SmsMessage; created: boolean }> {
  try {
    const row = await prisma.smsMessage.create({
      data: {
        organizationId: params.organizationId,
        memberId: params.memberId ?? null,
        phone: data.phone,
        body: data.body,
        status: "QUEUED",
        campaignId: params.campaignId ?? null,
        sentById: params.sentById ?? null,
      },
    });
    return { row, created: true };
  } catch (error) {
    if (isUniqueConstraintViolation(error) && params.campaignId && params.memberId) {
      const existing = await prisma.smsMessage.findFirst({
        where: { organizationId: params.organizationId, campaignId: params.campaignId, memberId: params.memberId },
      });
      if (existing) return { row: existing, created: false };
    }
    throw error;
  }
}

/**
 * Sends a single SMS to a member, recording every attempt. Never throws —
 * every failure mode (unconfigured, no entitlement, invalid phone, opted
 * out, Twilio error) is captured as a FAILED SmsMessage row instead.
 *
 * Initial-send state machine (Rounds 5–6) — ownership FIRST, authorization
 * under that ownership:
 *   1. create-or-resolve the canonical QUEUED row (campaign sends are
 *      unique per organization/campaign/member at the database level — a
 *      duplicate invocation gets the existing row back and stops). Only a
 *      pure, side-effect-free normalization precheck runs before this, to
 *      store a normalized number on the row.
 *   2. atomically claim QUEUED → SENDING with a lease/fencing value
 *      (claimInitialSmsAttempt; retryCount stays 0). Losing the claim means
 *      the admin Cancel action won — no reservation, no Twilio.
 *   3. run the FULL canonical authorization (authorizeSmsSend — the same
 *      decision the retry path applies after ITS claim) now that this
 *      worker owns the attempt, immediately before quota and the provider.
 *      Only this post-claim result may authorize Twilio; a member who
 *      opted out, was removed, or whose org lost the add-on moments
 *      earlier is denied here and the attempt finalizes as one truthful
 *      FAILED row under the fence — with zero reservation and zero
 *      provider calls.
 *   4. reserve allowance immediately before Twilio;
 *   5. finalize exactly once under the lease fence, keyed to the provider
 *      outcome: "sent" → SENT; "definitive_failure" → FAILED + single
 *      same-transaction release; "unknown" (timeout/transport/no-valid-SID)
 *      → parked SENDING with the lease cleared for manual reconciliation —
 *      quota stays consumed and no automatic path may touch the row again.
 *   A crashed initial attempt (SENDING, lease expired) is PARKED as
 *   outcome-unknown by the sweep — never automatically re-sent.
 */
export async function sendMemberSms(params: SendMemberSmsParams): Promise<SmsMessage> {
  const { organizationId, memberId, phone, body } = params;

  // Pure precheck only (no reads, no side effects): prefer storing the
  // normalized number on the row. The authoritative decision runs after
  // the claim.
  const normalizedForRow = normalizeToE164(phone) ?? phone;
  const finalBody = withOptOutSuffix(body);

  const attempt = await createOrResolveAttemptRow(params, { phone: normalizedForRow, body: finalBody });
  if (!attempt.created) {
    // Duplicate campaign invocation: the canonical attempt already exists
    // (possibly still in flight, possibly terminal). Treat as already
    // claimed/processed — report its current state, touch nothing.
    return attempt.row;
  }
  const queued = attempt.row;
  const refetch = async () => (await prisma.smsMessage.findUnique({ where: { id: queued.id } })) ?? queued;

  const claim = await claimInitialSmsAttempt(queued.id);
  if (!claim) {
    // The admin Cancel action consumed the QUEUED state first: the
    // cancellation is truthful — nothing was reserved, Twilio was never
    // called.
    return refetch();
  }

  // POST-CLAIM canonical authorization — consent/STOP/member/tenant/
  // entitlement re-resolved under this worker's ownership, as close as
  // possible to the reservation and the provider call.
  const authorization = await authorizeSmsSend({ organizationId, memberId, phone, required: params.required });
  if (!authorization.allowed) {
    await finalizeSmsAttemptFailure(claim, null, authorization.reason);
    return refetch();
  }

  // Database-atomic hard-stop: claim one unit of the monthly allowance
  // immediately BEFORE Twilio. Under concurrency (campaign workers run
  // 20-wide) only as many sends as there is remaining allowance can pass —
  // the entitlement pre-check inside authorizeSmsSend cannot guarantee that
  // on its own. The unit is consumed up-front; the returned token names the
  // exact billing period charged, and the one-time failure finalizer
  // releases against that token only, inside the same transaction as the
  // FAILED transition. Crash-consumes-capacity tradeoff documented on
  // reserveSmsAllowance.
  const reservation = await reserveSmsAllowance(organizationId);
  if (!reservation) {
    await finalizeSmsAttemptFailure(claim, null, "Your organization has used its full monthly SMS allowance.");
    return refetch();
  }

  const result = await sendSms({ to: authorization.normalizedPhone, body: finalBody });

  if (result.outcome === "sent") {
    await finalizeSmsAttemptSuccess(claim, {
      providerMessageId: result.providerMessageId ?? null,
      // A flat per-message estimate for internal admin cost visibility
      // only — NOT a customer billing rate (hard-stop policy: no
      // customer-facing overage billing exists).
      costEstimateCents: SMS_ADDON.overageRateCents,
    });
  } else if (result.outcome === "unknown") {
    await finalizeSmsAttemptUnknown(claim, result.reason ?? "Delivery outcome is unknown; verify in Twilio before retrying.");
  } else {
    await finalizeSmsAttemptFailure(claim, reservation, result.reason ?? "SMS send failed.");
  }

  return refetch();
}
