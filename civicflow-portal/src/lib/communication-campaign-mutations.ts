import type { CommunicationCampaign, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { resolveCommunicationRecipients, sendCommunicationCampaign } from "@/lib/communication-campaigns";
import { validateDeepLink } from "@/lib/deep-links";
import { getSmsEntitlement } from "@/lib/sms-entitlement";
import { requirePlanFeature } from "@/lib/plan-gate";
import { z, ValidationError } from "@/lib/validation";
import { getWhatsAppEntitlement } from "@/lib/whatsapp/entitlement";
import { getActiveTemplate, validateTemplateVariables } from "@/lib/whatsapp/templates";

/**
 * Shared CommunicationCampaign create logic — used by both the web portal
 * route (src/app/api/communications/campaigns/route.ts) and the mobile admin
 * route (src/app/api/mobile/admin/campaigns/route.ts). Extracted so neither
 * surface can drift from the other's entitlement gating, recipient
 * resolution, or audit behavior.
 */

export const createCampaignSchema = z.object({
  title: z.string().trim().min(1).max(200),
  communicationType: z.enum(["ANNOUNCEMENT", "MEETING_MINUTES", "DUES_REMINDER", "EVENT_NOTICE", "CAMPAIGN_UPDATE", "GENERAL", "OTHER"]),
  channel: z.enum(["EMAIL", "SMS", "EMAIL_AND_SMS", "INTERNAL_LOG_ONLY"]),
  subject: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1).max(20000),
  recipientFilter: z.record(z.string(), z.unknown()).optional(),
  attachmentKeys: z.array(z.string().max(500)).optional(),
  meetingId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  pushEnabled: z.boolean().optional(),
  deepLink: z.union([z.string().max(200), z.literal(""), z.null()]).optional(),
  scheduledFor: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
  sendNow: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  whatsappTemplateKey: z.string().min(1).max(100).optional(),
  whatsappTemplateVariables: z.record(z.string(), z.string()).optional(),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export interface CampaignMutationActor {
  userId: string;
  userEmail?: string | null;
}

export async function createCommunicationCampaign(
  organizationId: string,
  actor: CampaignMutationActor,
  input: CreateCampaignInput
): Promise<CommunicationCampaign> {
  if (input.channel === "EMAIL" || input.channel === "EMAIL_AND_SMS") {
    await requirePlanFeature(organizationId, "emailCampaigns");
  }

  if (input.channel === "SMS" || input.channel === "EMAIL_AND_SMS") {
    const entitlement = await getSmsEntitlement(organizationId);
    if (!entitlement.allowed) {
      throw new ValidationError(
        entitlement.reason ?? "Your organization does not have the SMS add-on enabled. Enable it in Billing Settings to send SMS campaigns."
      );
    }
  }

  let whatsappTemplateVariables: Record<string, string> | undefined;
  if (input.whatsappEnabled) {
    const entitlement = await getWhatsAppEntitlement(organizationId);
    if (!entitlement.allowed) {
      throw new ValidationError(entitlement.reason ?? "Your organization does not have the WhatsApp add-on enabled.");
    }
    if (!input.whatsappTemplateKey) {
      throw new ValidationError("Select a WhatsApp template.");
    }
    const template = await getActiveTemplate(input.whatsappTemplateKey);
    if (!template) {
      throw new ValidationError(`Template "${input.whatsappTemplateKey}" is not active or not approved.`);
    }
    const validation = validateTemplateVariables(template, input.whatsappTemplateVariables ?? {});
    if (!validation.valid) {
      throw new ValidationError(validation.reason);
    }
    whatsappTemplateVariables = validation.variables;
  }

  const recipientFilter = input.recipientFilter ?? { selector: "active_with_email" };
  const recipients = await resolveCommunicationRecipients(organizationId, recipientFilter, input.channel);

  const deepLink = input.deepLink ? validateDeepLink(input.deepLink) : null;
  if (input.deepLink && !deepLink) {
    throw new ValidationError("That deep link doesn't match a known app destination.");
  }
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;

  const campaign = await prisma.communicationCampaign.create({
    data: {
      organizationId,
      title: input.title.trim(),
      communicationType: input.communicationType,
      channel: input.channel,
      subject: input.subject.trim(),
      body: input.body.trim(),
      status: input.sendNow ? "READY" : scheduledFor ? "READY" : "DRAFT",
      recipientFilter: recipientFilter as Prisma.InputJsonValue,
      attachmentKeys: (input.attachmentKeys ?? []) as Prisma.InputJsonValue,
      meetingId: input.meetingId || null,
      pushEnabled: input.pushEnabled ?? false,
      deepLink,
      whatsappEnabled: input.whatsappEnabled ?? false,
      whatsappTemplateKey: input.whatsappEnabled ? input.whatsappTemplateKey : null,
      whatsappTemplateVariables: input.whatsappEnabled ? (whatsappTemplateVariables as Prisma.InputJsonValue) : undefined,
      scheduledFor,
      createdByUserId: actor.userId,
      recipients: {
        create: recipients.map((member) => ({ organizationId, memberId: member.id, email: member.email, phone: member.phone })),
      },
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "communication_campaign.create",
    entityType: "communication_campaign",
    entityId: campaign.id,
    metadata: {
      recipientCount: recipients.length,
      channel: campaign.channel,
      pushEnabled: campaign.pushEnabled,
      whatsappEnabled: campaign.whatsappEnabled,
      whatsappTemplateKey: campaign.whatsappTemplateKey,
      scheduledFor: campaign.scheduledFor,
    },
  });

  if (input.sendNow) {
    await sendCommunicationCampaign({ organizationId, campaignId: campaign.id, actorUserId: actor.userId, actorEmail: actor.userEmail });
  }

  return campaign;
}
