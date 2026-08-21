import type { CommunicationCampaign, CommunicationCampaignChannel, Prisma } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { buildMemberWhere, parseMemberFilters } from "@/lib/member-filters";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { sendEmail } from "@/lib/mail";
import { PlanFeatureError, requirePlanFeature } from "@/lib/plan-gate";
import { prisma } from "@/lib/prisma";
import { resolveOrganizationAccess } from "@/lib/subscription-gate";
import { sendPushToTokens } from "@/lib/push";
import { applySmsTemplateTokens, sendMemberSms } from "@/lib/sms-service";
import { getSignedObjectUrl } from "@/lib/storage";
import { getMobileAppWebBaseUrl } from "@/lib/env";
import { WhatsAppChannel } from "@/lib/communications/channel";
import { getWhatsAppEntitlement } from "@/lib/whatsapp/entitlement";
import { isWithinQuietHours } from "@/lib/whatsapp/quiet-hours";
import { resolvePtaTargetMemberIds, ptaTargetingRuleSchema, type PtaTargetingRule } from "@/lib/labs/pta/communications";
import { resolvePtaHouseholdAdultUserIdsBatch } from "@/lib/labs/pta/households";
import { ValidationError } from "@/lib/validation";

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
  /** PTA-only targeting rule (grade/classroom/committee/event volunteers/
   * unpaid dues). Never trust a client-resolved member list for this —
   * resolveCommunicationRecipients() always calls resolvePtaTargetMemberIds()
   * itself, server-side, from this rule spec. */
  ptaRule?: PtaTargetingRule;
};

function emailEnabled(channel: CommunicationCampaignChannel) {
  return channel === "EMAIL" || channel === "EMAIL_AND_SMS";
}

function smsEnabled(channel: CommunicationCampaignChannel) {
  return channel === "SMS" || channel === "EMAIL_AND_SMS";
}

/**
 * whatsappEnabled is an orthogonal additive flag on CommunicationCampaign
 * (mirrors pushEnabled), not a value of the `channel` enum — so, exactly
 * like push, it never affects resolveCommunicationRecipients()'s selection:
 * a WhatsApp-only member (no email/phone) is only reachable when `channel`
 * itself resolves them (e.g. INTERNAL_LOG_ONLY, which selects everyone).
 * Fixing that is the same pre-existing limitation push already has; not a
 * new WhatsApp-specific gap to solve here.
 */
function whatsappEnabled(campaign: Pick<CommunicationCampaign, "whatsappEnabled">) {
  return campaign.whatsappEnabled;
}

export async function resolveCommunicationRecipients(organizationId: string, filter: RecipientFilter, channel: CommunicationCampaignChannel) {
  const selector = filter.selector || "active_with_email";
  let where: Prisma.OrgMemberWhereInput = { organizationId };

  if (selector === "pta_target") {
    // Server-side enforcement, not just a hidden UI control: PTA targeting
    // is only ever resolved for a PTA-vertical organization, regardless of
    // what selector a crafted request claims.
    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { primaryVertical: true } });
    if (organization?.primaryVertical !== "PTA") {
      throw new ValidationError("PTA targeting is only available for PTA organizations.");
    }
    const parsed = ptaTargetingRuleSchema.safeParse(filter.ptaRule);
    if (!parsed.success) throw new ValidationError("A valid PTA targeting rule is required for this selector.");
    // Resolve server-side from the rule spec (never from a client-supplied
    // id list), then fall through to the exact same organization-scoped
    // "manual" lookup every other selector already goes through — no
    // separate recipient-resolution path to duplicate or drift from.
    const memberIds = await resolvePtaTargetMemberIds(organizationId, parsed.data);
    where = { organizationId, id: { in: memberIds } };
  } else if (selector === "manual") {
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

  const eligible = members.filter((member) => {
    if (channel === "INTERNAL_LOG_ONLY") return true;
    if (emailEnabled(channel) && member.email) return true;
    if (smsEnabled(channel) && member.phone) return true;
    return false;
  });

  // No PII — ids and counts only. Lets an operator see, from doctl apps
  // logs alone (no DB access needed), whether a campaign's recipient count
  // looks plausible for its selector/channel without waiting for a support
  // report; matches mail.ts's existing structured-event convention.
  console.log(
    JSON.stringify({
      event: "communication_recipients_resolved",
      organizationId,
      selector,
      channel,
      matchedCount: members.length,
      eligibleCount: eligible.length,
    })
  );

  return eligible;
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
    pushUserIdsByMemberId: Map<string, string[]>;
    whatsappQuietHours: { timezone: string; startHour: number; endHour: number } | null;
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
    if (ctx.campaign.pushEnabled && recipient.member) {
      // A PTA household's billing-identity OrgMember never carries a
      // personal userId of its own (see households.ts) — falling back to
      // its real adults' userIds here is what fixes a previously fully
      // silent gap: this block used to require recipient.member.userId
      // directly, so every PTA household recipient produced zero push sends
      // AND zero CommunicationLog row (the whole block was skipped, not
      // just the send), with no record anywhere that anything was missed.
      const pushUserIds = recipient.member.userId ? [recipient.member.userId] : (ctx.pushUserIdsByMemberId.get(recipient.memberId ?? "") ?? []);

      if (pushUserIds.length === 0) {
        pushDeliveryStatus = "SKIPPED";
        pushError = "No linked mobile login";
      } else if (recipient.member.commsPushEnabled && !recipient.member.requiredNoticesOnly) {
        const tokens = pushUserIds.flatMap((userId) => ctx.tokensByUserId.get(userId) ?? []);
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

    // WhatsApp is additive on top of the primary channel, exactly like push
    // above — never affects which recipients were resolved in the first
    // place. `null` (not "SKIPPED") means "left PENDING, try again on a
    // later batch" — used for the quiet-hours case, since
    // sendCommunicationCampaign() is always safe to re-call and only ever
    // picks up still-PENDING rows; the cron worker (/api/cron/campaigns)
    // resumes it automatically once outside quiet hours.
    let whatsappDeliveryStatus: "SENT" | "SKIPPED" | "FAILED" | null = null;
    let whatsappError: string | null = null;
    let whatsappStillPending = false;
    if (ctx.campaign.whatsappEnabled && recipient.member?.whatsappPhoneNumber) {
      const quietHours = ctx.whatsappQuietHours;
      if (quietHours && isWithinQuietHours(new Date(), quietHours.timezone, quietHours.startHour, quietHours.endHour)) {
        whatsappStillPending = true;
      } else {
        const result = await WhatsAppChannel.send({
          organizationId: ctx.organizationId,
          memberId: recipient.memberId,
          phone: recipient.member.whatsappPhoneNumber,
          templateKey: ctx.campaign.whatsappTemplateKey ?? undefined,
          templateVariables: (ctx.campaign.whatsappTemplateVariables as Record<string, string> | null) ?? undefined,
          campaignId: ctx.campaign.id,
          sentById: ctx.actorUserId ?? null,
        });
        whatsappDeliveryStatus = result.status;
        if (result.status === "FAILED") whatsappError = result.errorMessage ?? "Delivery failed";
      }
    }

    await prisma.communicationRecipient.update({
      where: { id: recipient.id },
      data: {
        // A WhatsApp send still pending (quiet hours) must not flip the
        // overall row to a terminal deliveryStatus either — otherwise this
        // recipient would never be picked up by a later PENDING-only batch.
        deliveryStatus: whatsappStillPending ? "PENDING" : deliveryStatus,
        errorMessage,
        sentAt: deliveryStatus === "SENT" ? new Date() : null,
        pushDeliveryStatus: pushDeliveryStatus ?? undefined,
        pushError,
        pushSentAt: pushDeliveryStatus === "SENT" ? new Date() : null,
        whatsappDeliveryStatus: whatsappStillPending ? undefined : (whatsappDeliveryStatus ?? undefined),
        whatsappError,
        whatsappSentAt: whatsappDeliveryStatus === "SENT" ? new Date() : null,
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

    if (whatsappDeliveryStatus) {
      await prisma.communicationLog.create({
        data: {
          organizationId: ctx.organizationId,
          memberId: recipient.memberId,
          createdByUserId: ctx.actorUserId ?? null,
          communicationType: "WHATSAPP",
          direction: "OUTBOUND",
          subject: ctx.campaign.title,
          // Template key, not rendered body text — WhatsApp/Meta render the
          // actual message from the approved template server-side, so we
          // never hold a literal copy of what was sent (same reasoning as
          // WhatsAppMessage.body's nullability in PR A).
          message: ctx.campaign.whatsappTemplateKey,
          outcome: whatsappDeliveryStatus === "SENT" ? "Sent" : whatsappError,
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
    // Same breakdown as the audit event above, but visible via doctl apps
    // logs directly — the audit event requires a DB query to see, this
    // doesn't. No PII: campaign/organization ids and counts only.
    console.log(JSON.stringify({ event: "communication_campaign_finalized", organizationId, campaignId, status, sent, skipped, failed }));
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

  // Same re-check-on-every-call reasoning as the email block above — a
  // campaign created while entitled but sent (by a resumed batch, or a
  // later cron tick) after the add-on lapses must not slip through.
  if (whatsappEnabled(campaign)) {
    const entitlement = await getWhatsAppEntitlement(input.organizationId);
    if (!entitlement.allowed) {
      await prisma.communicationCampaign.update({ where: { id: campaign.id }, data: { status: "FAILED" } });
      await createAuditEvent({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail,
        action: "communication_campaign.blocked",
        entityType: "communication_campaign",
        entityId: campaign.id,
        metadata: { reason: "whatsapp_entitlement_required" },
      });
      throw new Error(entitlement.reason ?? "WhatsApp is not enabled for this organization.");
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

  let whatsappQuietHours: { timezone: string; startHour: number; endHour: number } | null = null;
  if (whatsappEnabled(campaign)) {
    const [whatsappSettings, orgSettings] = await Promise.all([
      prisma.organizationWhatsAppSettings.findUnique({
        where: { organizationId: input.organizationId },
        select: { quietHoursStartHour: true, quietHoursEndHour: true },
      }),
      prisma.orgSettings.findUnique({ where: { organizationId: input.organizationId }, select: { timezone: true } }),
    ]);
    if (whatsappSettings) {
      whatsappQuietHours = {
        timezone: orgSettings?.timezone ?? "America/New_York",
        startHour: whatsappSettings.quietHoursStartHour,
        endHour: whatsappSettings.quietHoursEndHour,
      };
    }
  }

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

  // A PTA household's billing-identity OrgMember never has a personal
  // userId of its own — resolve its real adults' userIds as a push
  // fallback, batched in one query for every such recipient in this batch
  // rather than one call per recipient. Only queried when the campaign
  // actually has push enabled, mirroring the WhatsApp entitlement check's
  // own "only do this work if it's actually needed" pattern just above.
  const pushUserIdsByMemberId = new Map<string, string[]>();
  if (campaign.pushEnabled) {
    const householdBillingMemberIds = pendingRecipients
      .filter((recipient) => recipient.member && !recipient.member.userId)
      .map((recipient) => recipient.memberId)
      .filter((id): id is string => Boolean(id));
    const householdUserIds = await resolvePtaHouseholdAdultUserIdsBatch(input.organizationId, householdBillingMemberIds);
    for (const [memberId, resolvedUserIds] of householdUserIds) {
      pushUserIdsByMemberId.set(memberId, resolvedUserIds);
    }
  }

  // Batch-fetch every recipient's mobile device tokens up front, instead of
  // one query per recipient inside the loop — the single largest N+1 here.
  const directUserIds = pendingRecipients
    .map((recipient) => recipient.member?.userId)
    .filter((id): id is string => Boolean(id));
  const userIds = [...directUserIds, ...Array.from(pushUserIdsByMemberId.values()).flat()];
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
          pushUserIdsByMemberId,
          whatsappQuietHours,
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
  let skippedBilling = 0;
  for (const campaign of due) {
    try {
      // LAUNCH-BLOCKER subscription gate: a billing-inactive organization's
      // scheduled campaign is left exactly as-is (status/recipients
      // untouched, nothing deleted) rather than sent — it becomes eligible
      // again the next time this job runs after access is restored. This
      // deliberately does NOT implement a "don't blast a backlog" cutoff
      // policy; that's a separate product decision still to be made.
      const access = await resolveOrganizationAccess(campaign.organizationId);
      if (!access.allowed) {
        skippedBilling += 1;
        continue;
      }
      const result = await sendCommunicationCampaign({ organizationId: campaign.organizationId, campaignId: campaign.id });
      if (result.complete) sent += 1;
    } catch (error) {
      failed += 1;
      // No PII — ids and the error message only, never recipient data.
      console.error(
        JSON.stringify({
          event: "communication_campaign_scheduled_send_failed",
          organizationId: campaign.organizationId,
          campaignId: campaign.id,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }

  console.log(JSON.stringify({ event: "communication_campaigns_cron_completed", processed: due.length, sent, failed, skippedBilling }));

  return { processed: due.length, sent, failed, skippedBilling };
}
