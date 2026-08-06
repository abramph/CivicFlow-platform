import type { WhatsAppMessage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeToE164 } from "@/lib/phone";
import { getWhatsAppEntitlement, recordWhatsAppUsage } from "@/lib/whatsapp/entitlement";
import { isWhatsAppConfigured, sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { getActiveTemplate, validateTemplateVariables } from "@/lib/whatsapp/templates";
import { WHATSAPP_ADDON } from "@/lib/whatsapp/pricing";

export interface SendMemberWhatsAppParams {
  organizationId: string;
  memberId?: string | null;
  phone: string;
  campaignId?: string | null;
  sentById?: string | null;
  /**
   * Bypasses the member's own whatsappEnabled preference toggle — reserved
   * for legally required notices, mirrors the same param on
   * sendMemberSms()/sendPushToMember. Does NOT bypass whatsappOptInStatus or
   * whatsappOptedOutAt: those are consent/compliance gates, not a
   * preference, and must block every message with no exceptions.
   */
  required?: boolean;
  /** Approved template send — mutually exclusive with body. */
  templateKey?: string;
  templateVariables?: Record<string, string>;
  /** Freeform send (Sandbox testing, or a real open customer-service-window reply) — mutually exclusive with templateKey. */
  body?: string;
}

function failedRow(params: SendMemberWhatsAppParams, errorMessage: string) {
  return prisma.whatsAppMessage.create({
    data: {
      organizationId: params.organizationId,
      memberId: params.memberId ?? null,
      phone: params.phone,
      templateKey: params.templateKey ?? null,
      body: params.body ?? null,
      status: "FAILED",
      failedAt: new Date(),
      campaignId: params.campaignId ?? null,
      sentById: params.sentById ?? null,
      errorMessage,
    },
  });
}

/**
 * Sends a single WhatsApp message to a member, recording every attempt.
 * Mirrors sendMemberSms()'s contract exactly: never throws — every failure
 * mode (unconfigured, no entitlement, invalid phone, opted out, unapproved
 * template, Twilio error) is captured as a FAILED WhatsAppMessage row
 * instead.
 */
export async function sendMemberWhatsApp(params: SendMemberWhatsAppParams): Promise<WhatsAppMessage> {
  const { organizationId, memberId, phone, campaignId, sentById, required, templateKey, templateVariables, body } =
    params;

  if (Boolean(templateKey) === Boolean(body)) {
    return failedRow(params, "Exactly one of templateKey or body must be provided.");
  }

  if (!(await isWhatsAppConfigured())) {
    return failedRow(params, "WhatsApp delivery is not configured.");
  }

  const entitlement = await getWhatsAppEntitlement(organizationId);
  if (!entitlement.allowed) {
    return failedRow(params, entitlement.reason ?? "WhatsApp is not enabled for this organization.");
  }

  const normalizedPhone = normalizeToE164(phone);
  if (!normalizedPhone) {
    return failedRow(params, "Invalid phone number.");
  }

  if (memberId) {
    const member = await prisma.orgMember.findUnique({
      where: { id: memberId },
      select: { whatsappEnabled: true, whatsappOptedOutAt: true, whatsappOptInStatus: true },
    });
    if (member) {
      if (member.whatsappOptInStatus !== "OPTED_IN") {
        return failedRow(params, "Member has not opted in to WhatsApp.");
      }
      if (member.whatsappOptedOutAt) {
        return failedRow(params, "Member opted out of WhatsApp.");
      }
      if (!required && !member.whatsappEnabled) {
        return failedRow(params, "Member has WhatsApp notifications turned off.");
      }
    }
  }

  let category: "UTILITY" | "AUTHENTICATION" | "MARKETING" | null = null;
  let contentSid: string | undefined;
  let contentVariables: Record<string, string> | undefined;

  if (templateKey) {
    const template = await getActiveTemplate(templateKey);
    if (!template) {
      return failedRow(params, `Template "${templateKey}" is not active or not approved.`);
    }
    if (!template.twilioContentSid) {
      return failedRow(params, `Template "${templateKey}" has no synced Twilio Content SID.`);
    }
    const validation = validateTemplateVariables(template, templateVariables ?? {});
    if (!validation.valid) {
      return failedRow(params, validation.reason);
    }
    category = template.category;
    contentSid = template.twilioContentSid;
    contentVariables = validation.variables;
  }

  const queued = await prisma.whatsAppMessage.create({
    data: {
      organizationId,
      memberId: memberId ?? null,
      phone: normalizedPhone,
      templateKey: templateKey ?? null,
      category,
      body: templateKey ? null : body,
      status: "QUEUED",
      campaignId: campaignId ?? null,
      sentById: sentById ?? null,
    },
  });

  const result = await sendWhatsAppMessage({
    to: normalizedPhone,
    contentSid,
    contentVariables,
    body: templateKey ? undefined : body,
  });

  const updated = await prisma.whatsAppMessage.update({
    where: { id: queued.id },
    data: result.sent
      ? {
          status: "SENT",
          sentAt: new Date(),
          providerMessageId: result.providerMessageId ?? null,
          // Flat per-message estimate, not an exact billing ledger — same
          // deliberate simplification as sendMemberSms()'s costEstimateCents.
          costEstimateCents: WHATSAPP_ADDON.overageRateCents,
        }
      : { status: "FAILED", failedAt: new Date(), errorMessage: result.reason ?? "WhatsApp send failed." },
  });

  if (result.sent) {
    await recordWhatsAppUsage(organizationId);
  }

  return updated;
}
