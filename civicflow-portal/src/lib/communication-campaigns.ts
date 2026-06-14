import type { CommunicationCampaignChannel, Prisma } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { buildMemberWhere, parseMemberFilters } from "@/lib/member-filters";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { sendEmail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/sms";
import { getSignedObjectUrl } from "@/lib/storage";

type RecipientFilter = {
  selector?: string;
  membershipCategoryId?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  county?: string | null;
  delinquency?: string | null;
  memberIds?: string[];
  memberFilters?: Record<string, string>;
};

function emailEnabled(channel: CommunicationCampaignChannel) {
  return channel === "EMAIL" || channel === "EMAIL_AND_SMS";
}

function smsEnabled(channel: CommunicationCampaignChannel) {
  return channel === "SMS" || channel === "EMAIL_AND_SMS";
}

export async function resolveCommunicationRecipients(organizationId: string, filter: RecipientFilter, channel: CommunicationCampaignChannel) {
  const selector = filter.selector || "active_with_email";
  let where: Prisma.OrgMemberWhereInput = { organizationId };

  if (selector === "manual") {
    where = { organizationId, id: { in: filter.memberIds ?? [] } };
  } else if (selector === "filtered" && filter.memberFilters) {
    where = buildMemberWhere(organizationId, parseMemberFilters(filter.memberFilters));
  } else {
    where = {
      organizationId,
      membershipStatus: "active",
      ...(filter.membershipCategoryId ? { membershipCategoryId: filter.membershipCategoryId } : {}),
      ...(filter.city ? { city: { contains: filter.city, mode: "insensitive" } } : {}),
      ...(filter.state ? { state: { contains: filter.state, mode: "insensitive" } } : {}),
      ...(filter.zipCode ? { zipCode: { contains: filter.zipCode, mode: "insensitive" } } : {}),
      ...(filter.county ? { county: { contains: filter.county, mode: "insensitive" } } : {}),
      ...(selector === "delinquent" || filter.delinquency === "delinquent" ? { isDelinquent: true } : {}),
    };
  }

  const members = await prisma.orgMember.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    take: 5000,
  });

  return members.filter((member) => {
    if (channel === "INTERNAL_LOG_ONLY") return true;
    if (emailEnabled(channel) && member.email) return true;
    if (smsEnabled(channel) && member.phone) return true;
    return false;
  });
}

export async function sendCommunicationCampaign(input: {
  organizationId: string;
  campaignId: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
}) {
  const campaign = await prisma.communicationCampaign.findFirst({
    where: { id: input.campaignId, organizationId: input.organizationId },
    include: { recipients: { include: { member: true } } },
  });
  if (!campaign) throw new Error("Communication campaign not found");
  if (campaign.status === "SENT") throw new Error("Communication campaign has already been sent");

  await prisma.communicationCampaign.update({ where: { id: campaign.id }, data: { status: "SENDING" } });

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const uploadedAttachments = await prisma.attachment.findMany({
    where: {
      organizationId: input.organizationId,
      entityType: "COMMUNICATION_CAMPAIGN",
      entityId: campaign.id,
      deletedAt: null,
    },
    orderBy: { uploadedAt: "desc" },
  });
  const attachmentLines = [];
  for (const attachment of uploadedAttachments) {
    const url = await getSignedObjectUrl(attachment.objectKey, 7 * 24 * 60 * 60);
    attachmentLines.push(`${attachment.title || attachment.fileName}: ${url}`);
  }
  const messageBody = attachmentLines.length
    ? `${campaign.body}\n\nAttachments:\n${attachmentLines.join("\n")}`
    : campaign.body;

  for (const recipient of campaign.recipients) {
    try {
      let deliveryStatus: "SENT" | "SKIPPED" = "SKIPPED";
      let errorMessage: string | null = null;
      if (emailEnabled(campaign.channel) && recipient.email) {
        const result = await sendEmail({ to: recipient.email, subject: campaign.subject, text: messageBody });
        deliveryStatus = result.sent ? "SENT" : "SKIPPED";
        errorMessage = result.skipped ? result.reason ?? "Email sending skipped" : null;
      }
      if (smsEnabled(campaign.channel) && recipient.phone) {
        const result = await sendSms({ to: recipient.phone, body: campaign.body });
        if (result.sent) deliveryStatus = "SENT";
        if (result.skipped && !errorMessage) errorMessage = result.reason;
      }
      if (campaign.channel === "INTERNAL_LOG_ONLY") {
        deliveryStatus = "SKIPPED";
        errorMessage = "Internal log only";
      }

      await prisma.communicationRecipient.update({
        where: { id: recipient.id },
        data: { deliveryStatus, errorMessage, sentAt: deliveryStatus === "SENT" ? new Date() : null },
      });

      await prisma.communicationLog.create({
        data: {
          organizationId: input.organizationId,
          memberId: recipient.memberId,
          createdByUserId: input.actorUserId ?? null,
          communicationType: campaign.channel === "SMS" ? "SMS" : "EMAIL",
          direction: "OUTBOUND",
          subject: campaign.subject,
          message: messageBody,
          outcome: deliveryStatus === "SENT" ? "Sent" : errorMessage,
          communicationDate: new Date(),
        },
      });

      if (recipient.memberId) {
        await createMemberTimelineEvent({
          organizationId: input.organizationId,
          memberId: recipient.memberId,
          eventType: "COMMUNICATION_LOGGED",
          title: "Communication campaign sent",
          newValue: { campaignId: campaign.id, deliveryStatus },
          createdByUserId: input.actorUserId,
        });
      }

      if (deliveryStatus === "SENT") sent += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      await prisma.communicationRecipient.update({
        where: { id: recipient.id },
        data: { deliveryStatus: "FAILED", errorMessage: error instanceof Error ? error.message : "Delivery failed" },
      });
    }
  }

  const status = failed > 0 ? "FAILED" : "SENT";
  await prisma.communicationCampaign.update({ where: { id: campaign.id }, data: { status, sentAt: new Date() } });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: "communication_campaign.send",
    entityType: "communication_campaign",
    entityId: campaign.id,
    metadata: { sent, skipped, failed, attachmentCount: uploadedAttachments.length },
  });

  return { sent, skipped, failed };
}
