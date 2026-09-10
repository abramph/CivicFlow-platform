import type { SmsMessage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reserveSmsAllowance } from "@/lib/sms-entitlement";
import { finalizeSmsAttemptFailure, finalizeSmsAttemptSuccess } from "@/lib/sms-attempt-finalization";
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

function failedRow(params: SendMemberSmsParams, errorMessage: string) {
  return prisma.smsMessage.create({
    data: {
      organizationId: params.organizationId,
      memberId: params.memberId ?? null,
      phone: params.phone,
      body: params.body,
      status: "FAILED",
      campaignId: params.campaignId ?? null,
      sentById: params.sentById ?? null,
      errorMessage,
    },
  });
}

/**
 * Sends a single SMS to a member, recording every attempt. Never throws —
 * every failure mode (unconfigured, no entitlement, invalid phone, opted
 * out, Twilio error) is captured as a FAILED SmsMessage row instead.
 *
 * All eligibility rules live in authorizeSmsSend (lib/sms-send-authorization)
 * — the same canonical decision the retry/cron path applies — so a rule can
 * never exist here without also protecting retries.
 */
export async function sendMemberSms(params: SendMemberSmsParams): Promise<SmsMessage> {
  const { organizationId, memberId, phone, body, campaignId, sentById, required } = params;

  const authorization = await authorizeSmsSend({ organizationId, memberId, phone, required });
  if (!authorization.allowed) {
    return failedRow(params, authorization.reason);
  }
  const normalizedPhone = authorization.normalizedPhone;

  const finalBody = withOptOutSuffix(body);

  const queued = await prisma.smsMessage.create({
    data: {
      organizationId,
      memberId: memberId ?? null,
      phone: normalizedPhone,
      body: finalBody,
      status: "QUEUED",
      campaignId: campaignId ?? null,
      sentById: sentById ?? null,
    },
  });

  // The QUEUED row created above IS this attempt's one-time claim: every
  // terminal outcome below commits through the fenced finalizers in
  // lib/sms-attempt-finalization.ts, whose conditional QUEUED-scoped
  // transition can succeed at most once — so a replayed failure path can
  // never release the same allowance unit twice, and this request can
  // never overwrite a status someone else (e.g. the admin Cancel action,
  // or the delivery webhook after a later retry) already committed.
  const claim = { kind: "initial", messageId: queued.id } as const;
  const refetch = async () => (await prisma.smsMessage.findUnique({ where: { id: queued.id } })) ?? queued;

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

  const result = await sendSms({ to: normalizedPhone, body: finalBody });

  if (result.sent) {
    await finalizeSmsAttemptSuccess(claim, {
      providerMessageId: result.providerMessageId ?? null,
      // A flat per-message estimate for internal admin cost visibility
      // only — NOT a customer billing rate (hard-stop policy: no
      // customer-facing overage billing exists).
      costEstimateCents: SMS_ADDON.overageRateCents,
    });
  } else {
    await finalizeSmsAttemptFailure(claim, reservation, result.reason ?? "SMS send failed.");
  }

  return refetch();
}
