import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { resolveCommunicationRecipients, sendCommunicationCampaign } from "@/lib/communication-campaigns";
import { validateDeepLink } from "@/lib/deep-links";
import { getSmsEntitlement } from "@/lib/sms-entitlement";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const createCampaignSchema = z.object({
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
});

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("communications:read", "throw");
    const rows = await prisma.communicationCampaign.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, include: { _count: { select: { recipients: true } } }, take: 100 });
    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("communications:write", "throw");
    const input = await parseJsonBody(request, createCampaignSchema);

    if (input.channel === "SMS" || input.channel === "EMAIL_AND_SMS") {
      const entitlement = await getSmsEntitlement(organizationId);
      if (!entitlement.allowed) {
        throw new ValidationError(
          entitlement.reason ?? "Your organization does not have the SMS add-on enabled. Enable it in Billing Settings to send SMS campaigns."
        );
      }
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
        scheduledFor,
        createdByUserId: session.userId,
        recipients: {
          create: recipients.map((member) => ({ organizationId, memberId: member.id, email: member.email, phone: member.phone })),
        },
      },
    });
    await createAuditEvent({ organizationId, actorUserId: session.userId, actorEmail: session.userEmail, action: "communication_campaign.create", entityType: "communication_campaign", entityId: campaign.id, metadata: { recipientCount: recipients.length, channel: campaign.channel, pushEnabled: campaign.pushEnabled, scheduledFor: campaign.scheduledFor } });
    if (input.sendNow) {
      await sendCommunicationCampaign({ organizationId, campaignId: campaign.id, actorUserId: session.userId, actorEmail: session.userEmail });
    }
    return Response.json({ ok: true, data: campaign }, { status: 201 });
  });
}
