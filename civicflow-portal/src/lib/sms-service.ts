import type { SmsMessage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeToE164 } from "@/lib/phone";
import { getSmsEntitlement, recordSmsUsage } from "@/lib/sms-entitlement";
import { isSmsConfigured, sendSms } from "@/lib/sms";
import { SMS_ADDON } from "@/lib/sms-pricing";

const OPT_OUT_SUFFIX = "Reply STOP to opt out.";

function withOptOutSuffix(body: string): string {
  if (body.toLowerCase().includes("stop to opt out")) return body;
  return `${body}\n\n${OPT_OUT_SUFFIX}`;
}

/**
 * Substitutes {organizationName}/{link} tokens in an SMS body, e.g.
 * "Reminder: Your {organizationName} dues are due. Open CivicFlow: {link}".
 * No other channel has templating today, so this stays a plain string
 * substitution rather than a general templating system.
 */
export function applySmsTemplateTokens(body: string, tokens: { organizationName: string; link?: string | null }): string {
  return body.replaceAll("{organizationName}", tokens.organizationName).replaceAll("{link}", tokens.link ?? "");
}

export interface SendMemberSmsParams {
  organizationId: string;
  memberId?: string | null;
  phone: string;
  body: string;
  campaignId?: string | null;
  sentById?: string | null;
  /** Bypasses the member's own opt-out preference — reserved for legally required notices, mirrors the `required` param on sendPushToMember in lib/push.ts. */
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
 */
export async function sendMemberSms(params: SendMemberSmsParams): Promise<SmsMessage> {
  const { organizationId, memberId, phone, body, campaignId, sentById, required } = params;

  if (!(await isSmsConfigured())) {
    return failedRow(params, "SMS delivery is not configured.");
  }

  const entitlement = await getSmsEntitlement(organizationId);
  if (!entitlement.allowed) {
    return failedRow(params, entitlement.reason ?? "SMS is not enabled for this organization.");
  }

  const normalizedPhone = normalizeToE164(phone);
  if (!normalizedPhone) {
    return failedRow(params, "Invalid phone number.");
  }

  if (memberId && !required) {
    const member = await prisma.orgMember.findUnique({
      where: { id: memberId },
      select: { commsSmsEnabled: true, smsOptedOutAt: true },
    });
    if (member && (!member.commsSmsEnabled || member.smsOptedOutAt)) {
      return failedRow(params, "Member opted out of SMS.");
    }
  }

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

  const result = await sendSms({ to: normalizedPhone, body: finalBody });

  const updated = await prisma.smsMessage.update({
    where: { id: queued.id },
    data: result.sent
      ? {
          status: "SENT",
          sentAt: new Date(),
          providerMessageId: result.providerMessageId ?? null,
          // A flat per-message estimate, not an exact included-vs-overage
          // split — good enough for admin visibility, not a billing ledger.
          costEstimateCents: SMS_ADDON.overageRateCents,
        }
      : { status: "FAILED", errorMessage: result.reason ?? "SMS send failed." },
  });

  if (result.sent) {
    await recordSmsUsage(organizationId);
  }

  return updated;
}
