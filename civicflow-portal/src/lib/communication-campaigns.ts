import type { CommunicationCampaign, CommunicationCampaignChannel, Prisma } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { buildMemberWhere, parseMemberFilters } from "@/lib/member-filters";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { sendEmail } from "@/lib/mail";
import { PlanFeatureError, requirePlanFeature } from "@/lib/plan-gate";
import { prisma } from "@/lib/prisma";
import { sendPushToTokens } from "@/lib/push";
import { applySmsTemplateTokens, sendMemberSms } from "@/lib/sms-service";
import { getSignedObjectUrl } from "@/lib/storage";
import { getMobileAppWebBaseUrl } from "@/lib/env";

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
  } else if (selector === "outstanding_dues") {
    where = {
      organizationId,
      duesCharges: { some: { organizationId, status: { in: ["PENDING", "PARTIAL"] } } },
    };
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

// Max recipients processed synchronously per sendCommunicationCampaign()
// invocation, and the concurrency within that batch. A campaign under this
// size (true of every current organization) completes fully within the
// initiating request; anything larger is picked up in further batches by
// processScheduledCampaigns() (or a repeat "Send Now" click), since
// recipients are only ever pulled by deliveryStatus: PENDING — safe to call
// this function again at any time.
const RECIPIENT_BATCH_SIZE = 300;
const SEND_CONCURRENCY = 20;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

type PendingRecipient = Prisma.CommunicationRecipientGetPayload<{ include: { member: true } }>;

async function processRecipient(
  recipient: PendingRecipient,
  ctx: {
    campaign: CommunicationCampaign;
    organizationId: string;
    actorUserId?: string | null;
    messageBody: string;
    smsBody: string;
    isMultiChannel: boolean;
    tokensByUserId: Map<string, string[]>;
  }
): Promise<"SENT" | "SKIPPED" | "FAILED"> {
  try {
    let deliveryStatus: "SENT" | "SKIPPED" = "SKIPPED";
    let errorMessage: string | null = null;
    // For EMAIL_AND_SMS, either channel succeeding counts as SENT overall,
    // but a per-channel failure is still worth surfacing — label each
    // reason by channel so "Sent" + an error doesn't read as a
    // contradiction, and so a failure on one channel isn't silently
    // dropped when the other also fails.
    // sendEmail() has no notion of a recipient's own preferences (it's also
    // used for transactional mail that must always go out), so — mirroring
    // sendMemberSms()'s own commsSmsEnabled check just below — the opt-out
    // check for bulk campaigns has to live here, at the campaign call site,
    // rather than inside the mailer itself.
    if (emailEnabled(ctx.campaign.channel) && recipient.email && recipient.member && !recipient.member.commsEmailEnabled) {
      errorMessage = ctx.isMultiChannel ? "Email: Member opted out of email notifications" : "Member opted out of email notifications";
    } else if (emailEnabled(ctx.campaign.channel) && recipient.email) {
      const result = await sendEmail({ to: recipient.email, subject: ctx.campaign.subject, text: ctx.messageBody });
      deliveryStatus = result.sent ? "SENT" : "SKIPPED";
      if (result.skipped) {
        const reason = result.reason ?? "Email sending skipped";
        errorMessage = ctx.isMultiChannel ? `Email: ${reason}` : reason;
      }
    }
    if (smsEnabled(ctx.campaign.channel) && recipient.phone) {
      const result = await sendMemberSms({
        organizationId: ctx.organizationId,
        memberId: recipient.memberId,
        phone: recipient.phone,
        body: ctx.smsBody,
        campaignId: ctx.campaign.id,
        sentById: ctx.actorUserId ?? null,
      });
      if (result.status === "SENT") deliveryStatus = "SENT";
      if (result.status === "FAILED") {
        const reason = result.errorMessage ?? "SMS send failed";
        const smsError = ctx.isMultiChannel ? `SMS: ${reason}` : reason;
        errorMessage = errorMessage ? `${errorMessage}; ${smsError}` : smsError;
      }
    }
    if (ctx.campaign.channel === "INTERNAL_LOG_ONLY") {
      deliveryStatus = "SKIPPED";
      errorMessage = "Internal log only";
    }

    let pushDeliveryStatus: "SENT" | "SKIPPED" | "FAILED" | null = null;
    let pushError: string | null = null;
    if (ctx.campaign.pushEnabled && recipient.member?.userId) {
      if (recipient.member.commsPushEnabled && !recipient.member.requiredNoticesOnly) {
        const tokens = ctx.tokensByUserId.get(recipient.member.userId) ?? [];
        // Staff can set an explicit deepLink; otherwise an announcement-type
        // campaign defaults to its own detail screen so tapping the push
        // actually opens that announcement instead of just the list.
        const isAnnouncementLike = ctx.campaign.communicationType === "ANNOUNCEMENT" || ctx.campaign.communicationType === "GENERAL";
        const deepLink = ctx.campaign.deepLink ?? (isAnnouncementLike ? `/announcement/${ctx.campaign.id}` : null);
        const result = await sendPushToTokens(tokens, {
          title: ctx.campaign.title,
          body: ctx.campaign.body,
          deepLink,
        });
        pushDeliveryStatus = result.sent > 0 ? "SENT" : tokens.length === 0 ? "SKIPPED" : "FAILED";
        if (pushDeliveryStatus !== "SENT") pushError = tokens.length === 0 ? "No registered devices" : "Delivery failed";
      } else {
        pushDeliveryStatus = "SKIPPED";
        pushError = recipient.member.requiredNoticesOnly
          ? "Member opted into required notices only"
          : "Member opted out of push notifications";
      }
    }

    await prisma.communicationRecipient.update({
      where: { id: recipient.id },
      data: {
        deliveryStatus,
        errorMessage,
        sentAt: deliveryStatus === "SENT" ? new Date() : null,
        pushDeliveryStatus: pushDeliveryStatus ?? undefined,
        pushError,
        pushSentAt: pushDeliveryStatus === "SENT" ? new Date() : null,
      },
    });

    await prisma.communicationLog.create({
      data: {
        organizationId: ctx.organizationId,
        memberId: recipient.memberId,
        createdByUserId: ctx.actorUserId ?? null,
        communicationType: ctx.campaign.channel === "SMS" ? "SMS" : "EMAIL",
        direction: "OUTBOUND",
        subject: ctx.campaign.subject,
        message: ctx.messageBody,
        outcome: deliveryStatus === "SENT" ? "Sent" : errorMessage,
        communicationDate: new Date(),
      },
    });

    if (pushDeliveryStatus) {
      await prisma.communicationLog.create({
        data: {
          organizationId: ctx.organizationId,
          memberId: recipient.memberId,
          createdByUserId: ctx.actorUserId ?? null,
          communicationType: "PUSH",
          direction: "OUTBOUND",
          subject: ctx.campaign.title,
          message: ctx.campaign.body,
          outcome: pushDeliveryStatus === "SENT" ? "Sent" : pushError,
          communicationDate: new Date(),
        },
      });
    }

    if (recipient.memberId) {
      await createMemberTimelineEvent({
        organizationId: ctx.organizationId,
        memberId: recipient.memberId,
        eventType: "COMMUNICATION_LOGGED",
        title: "Communication campaign sent",
        newValue: { campaignId: ctx.campaign.id, deliveryStatus },
        createdByUserId: ctx.actorUserId,
      });
    }

    return deliveryStatus;
  } catch (error) {
    await prisma.communicationRecipient.update({
      where: { id: recipient.id },
      data: { deliveryStatus: "FAILED", errorMessage: error instanceof Error ? error.message : "Delivery failed" },
    });
    return "FAILED";
  }
}

/** Sets the campaign's final SENT/FAILED status and writes the one audit
 * event for the whole send — guarded by a conditional update so that only
 * the invocation which actually flips the status off SENDING/READY writes
 * it, even if two batches race to finalize the same campaign. */
async function finalizeCampaign(
  campaignId: string,
  organizationId: string,
  actorUserId?: string | null,
  actorEmail?: string | null
) {
  const [sent, skipped, failed] = await Promise.all([
    prisma.communicationRecipient.count({ where: { campaignId, deliveryStatus: "SENT" } }),
    prisma.communicationRecipient.count({ where: { campaignId, deliveryStatus: "SKIPPED" } }),
    prisma.communicationRecipient.count({ where: { campaignId, deliveryStatus: "FAILED" } }),
  ]);
  const status = failed > 0 ? "FAILED" : "SENT";

  const { count } = await prisma.communicationCampaign.updateMany({
    where: { id: campaignId, status: { notIn: ["SENT", "FAILED"] } },
    data: { status, sentAt: new Date() },
  });

  if (count > 0) {
    await createAuditEvent({
      organizationId,
      actorUserId,
      actorEmail,
      action: "communication_campaign.send",
      entityType: "communication_campaign",
      entityId: campaignId,
      metadata: { sent, skipped, failed },
    });
  }

  return { sent, skipped, failed };
}

/**
 * Processes up to RECIPIENT_BATCH_SIZE still-PENDING recipients of a
 * campaign, with SEND_CONCURRENCY-wide concurrency, and finalizes the
 * campaign once no PENDING recipients remain. Idempotent and resumable:
 * safe to call repeatedly (a repeat "Send Now" click, or a later cron
 * tick / processScheduledCampaigns pass) — it always just picks up
 * whatever is still PENDING.
 */
export async function sendCommunicationCampaign(input: {
  organizationId: string;
  campaignId: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
}) {
  const campaign = await prisma.communicationCampaign.findFirst({
    where: { id: input.campaignId, organizationId: input.organizationId },
  });
  if (!campaign) throw new Error("Communication campaign not found");
  if (campaign.status === "SENT" || campaign.status === "FAILED") {
    return { sent: 0, skipped: 0, failed: 0, remainingPending: 0, complete: true };
  }

  // Re-checked fresh on every call — not just at creation time — so a
  // campaign scheduled while entitled but sent (by a "Send Now" click, the
  // cron worker, or a resumed batch) after a downgrade doesn't slip through.
  // Marked FAILED immediately (rather than left READY) so the cron worker
  // doesn't retry it forever on every future tick.
  if (emailEnabled(campaign.channel)) {
    try {
      await requirePlanFeature(input.organizationId, "emailCampaigns");
    } catch (error) {
      if (error instanceof PlanFeatureError) {
        await prisma.communicationCampaign.update({ where: { id: campaign.id }, data: { status: "FAILED" } });
        await createAuditEvent({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          actorEmail: input.actorEmail,
          action: "communication_campaign.blocked",
          entityType: "communication_campaign",
          entityId: campaign.id,
          metadata: { reason: "plan_feature_required", feature: "emailCampaigns" },
        });
      }
      throw error;
    }
  }

  const pendingRecipients = await prisma.communicationRecipient.findMany({
    where: { campaignId: campaign.id, deliveryStatus: "PENDING" },
    include: { member: true },
    orderBy: { createdAt: "asc" },
    take: RECIPIENT_BATCH_SIZE,
  });

  if (pendingRecipients.length === 0) {
    const totals = await finalizeCampaign(campaign.id, input.organizationId, input.actorUserId, input.actorEmail);
    return { ...totals, remainingPending: 0, complete: true };
  }

  if (campaign.status !== "SENDING") {
    await prisma.communicationCampaign.update({ where: { id: campaign.id }, data: { status: "SENDING" } });
  }

  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { name: true },
  });
  const smsLink = campaign.deepLink ? `${getMobileAppWebBaseUrl()}${campaign.deepLink}` : null;
  const smsBody = applySmsTemplateTokens(campaign.body, {
    organizationName: organization?.name ?? "your organization",
    link: smsLink,
  });

  const uploadedAttachments = await prisma.attachment.findMany({
    where: {
      organizationId: input.organizationId,
      entityType: "COMMUNICATION_CAMPAIGN",
      entityId: campaign.id,
      deletedAt: null,
    },
    orderBy: { uploadedAt: "desc" },
  });
  const attachmentLines: string[] = [];
  for (const attachment of uploadedAttachments) {
    const url = await getSignedObjectUrl(attachment.objectKey, 7 * 24 * 60 * 60);
    attachmentLines.push(`${attachment.title || attachment.fileName}: ${url}`);
  }
  const messageBody = attachmentLines.length
    ? `${campaign.body}\n\nAttachments:\n${attachmentLines.join("\n")}`
    : campaign.body;

  // Batch-fetch every recipient's mobile device tokens up front, instead of
  // one query per recipient inside the loop — the single largest N+1 here.
  const userIds = pendingRecipients
    .map((recipient) => recipient.member?.userId)
    .filter((id): id is string => Boolean(id));
  const deviceTokens = userIds.length
    ? await prisma.mobileDeviceToken.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, token: true },
      })
    : [];
  const tokensByUserId = new Map<string, string[]>();
  for (const deviceToken of deviceTokens) {
    const list = tokensByUserId.get(deviceToken.userId) ?? [];
    list.push(deviceToken.token);
    tokensByUserId.set(deviceToken.userId, list);
  }

  const isMultiChannel = campaign.channel === "EMAIL_AND_SMS";
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const batch of chunk(pendingRecipients, SEND_CONCURRENCY)) {
    const outcomes = await Promise.all(
      batch.map((recipient) =>
        processRecipient(recipient, {
          campaign,
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          messageBody,
          smsBody,
          isMultiChannel,
          tokensByUserId,
        })
      )
    );
    for (const outcome of outcomes) {
      if (outcome === "SENT") sent += 1;
      else if (outcome === "FAILED") failed += 1;
      else skipped += 1;
    }
  }

  const remainingPending = await prisma.communicationRecipient.count({
    where: { campaignId: campaign.id, deliveryStatus: "PENDING" },
  });

  if (remainingPending === 0) {
    const totals = await finalizeCampaign(campaign.id, input.organizationId, input.actorUserId, input.actorEmail);
    return { ...totals, remainingPending: 0, complete: true };
  }

  return { sent, skipped, failed, remainingPending, complete: false };
}

/**
 * Fires every campaign scheduled for now-or-earlier that hasn't gone out
 * yet, and resumes any campaign still SENDING with PENDING recipients left
 * over from a previous batch (e.g. a very large recipient list that
 * exceeded RECIPIENT_BATCH_SIZE in one pass). Called by the cron/campaigns
 * route — mirrors processPendingReminderLogs' cross-organization pattern.
 */
export async function processScheduledCampaigns(limit = 50) {
  const due = await prisma.communicationCampaign.findMany({
    where: {
      OR: [
        { status: "READY", scheduledFor: { lte: new Date() } },
        { status: "SENDING", recipients: { some: { deliveryStatus: "PENDING" } } },
      ],
    },
    orderBy: { scheduledFor: "asc" },
    take: limit,
  });

  let sent = 0;
  let failed = 0;
  for (const campaign of due) {
    try {
      const result = await sendCommunicationCampaign({ organizationId: campaign.organizationId, campaignId: campaign.id });
      if (result.complete) sent += 1;
    } catch {
      failed += 1;
    }
  }

  return { processed: due.length, sent, failed };
}
