import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { isPtaVolunteerHoursOrgAllowed, isPtaVolunteerHoursPlatformEnabled } from "@/lib/env";
import { sendEmail } from "@/lib/mail";
import { resolveOrganizationAccess } from "@/lib/subscription-gate";
import { PtaError } from "../errors";
import { requireVolunteerHoursFlag } from "./guard";
import { getVolunteerRequirementPeriod, listVolunteerRequirementPeriods } from "./periods";
import { listPricingWindows } from "./pricing";
import { buildHouseholdReportContexts } from "./reports/shared";

/**
 * Volunteer Hour Requirements & Buyout program, VH-L (docs/pta-volunteer-hours.md).
 *
 * Every automated notification this feature can send. Off by default —
 * every sweep function checks ptaVolunteerNotificationsEnabled (+ the
 * platform kill-switch) itself before doing anything, mirroring
 * volunteer-reminders.ts's own billing-access check-once-here pattern
 * rather than trusting every caller to remember. Dedup is a
 * PtaVolunteerNotificationLog row per (household, notificationType,
 * sourceId) — send-then-log, same accepted ordering
 * sendVolunteerRemindersForOrganization already uses (a crash between send
 * and log-write risks a rare duplicate email, never a missed one; the
 * unique constraint below makes a genuine double-run still land only one
 * log row).
 */

const DEFAULT_DEADLINE_LOOKAHEAD_DAYS = 14;
const DEFAULT_RATE_CHANGE_LOOKAHEAD_DAYS = 7;

export interface NotificationRunResult {
  organizationId: string;
  sent: number;
  skippedNoContact: number;
  failed: number;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

function emptyResult(organizationId: string): NotificationRunResult {
  return { organizationId, sent: 0, skippedNoContact: 0, failed: 0 };
}

async function logNotification(params: {
  organizationId: string;
  requirementPeriodId: string;
  householdId: string;
  notificationType: "DEADLINE_REMINDER" | "ASSESSMENT_POSTED" | "RATE_CHANGE_UPCOMING";
  sourceId: string;
  pricingWindowId?: string | null;
  recipientEmail: string;
}) {
  try {
    await prisma.ptaVolunteerNotificationLog.create({ data: params });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
}

/** Deadline-reminder sweep: one email per household still short on hours as
 * the period's volunteerDeadline approaches, sent at most once per
 * household per period regardless of how many times this runs. */
export async function sendVolunteerHoursDeadlineReminders(
  organizationId: string,
  periodId: string,
  options: { lookaheadDays?: number; actorUserId?: string | null; actorEmail?: string | null } = {}
): Promise<NotificationRunResult> {
  const result = emptyResult(organizationId);

  const flagsOk = await requireVolunteerHoursFlag(organizationId, "notifications").catch(() => null);
  if (!flagsOk) return result;

  const access = await resolveOrganizationAccess(organizationId);
  if (!access.allowed) return result;

  const period = await getVolunteerRequirementPeriod(organizationId, periodId).catch(() => null);
  if (!period || !period.volunteerDeadline || period.status !== "ACTIVE") return result;

  const lookaheadDays = options.lookaheadDays ?? DEFAULT_DEADLINE_LOOKAHEAD_DAYS;
  const now = new Date();
  const lookaheadEnd = new Date(now.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);
  if (period.volunteerDeadline < now || period.volunteerDeadline > lookaheadEnd) return result;

  const contexts = await buildHouseholdReportContexts(organizationId, { requirementPeriodId: periodId });
  const notMet = contexts.filter((c) => !c.requirement.exempt && c.remainingMinutes > 0);
  if (notMet.length === 0) return result;

  const alreadySent = await prisma.ptaVolunteerNotificationLog.findMany({
    where: { organizationId, notificationType: "DEADLINE_REMINDER", sourceId: periodId, householdId: { in: notMet.map((c) => c.householdId) } },
    select: { householdId: true },
  });
  const alreadySentIds = new Set(alreadySent.map((r) => r.householdId));
  const candidates = notMet.filter((c) => !alreadySentIds.has(c.householdId));
  if (candidates.length === 0) return result;

  const households = await prisma.ptaHousehold.findMany({
    where: { id: { in: candidates.map((c) => c.householdId) } },
    select: { id: true, primaryContact: { select: { name: true, email: true } } },
  });
  const householdById = new Map(households.map((h) => [h.id, h]));

  for (const ctx of candidates) {
    const household = householdById.get(ctx.householdId);
    const email = household?.primaryContact?.email?.trim();
    if (!email) {
      result.skippedNoContact += 1;
      continue;
    }
    try {
      await sendEmail({
        to: email,
        subject: `Volunteer hours due soon — ${period.name}`,
        text: [
          `Hi ${household?.primaryContact?.name ?? "there"},`,
          "",
          `Your family still has ${(ctx.remainingMinutes / 60).toFixed(2)} volunteer hour(s) remaining for ${period.name}.`,
          `Deadline: ${period.volunteerDeadline.toLocaleDateString("en-US", { dateStyle: "long" })}`,
          "",
          "Log in to your Unestra portal to record hours or explore buyout options if available.",
        ].join("\n"),
      });
      await logNotification({
        organizationId,
        requirementPeriodId: periodId,
        householdId: ctx.householdId,
        notificationType: "DEADLINE_REMINDER",
        sourceId: periodId,
        recipientEmail: email,
      });
      result.sent += 1;
    } catch {
      result.failed += 1;
    }
  }

  if (result.sent > 0 || result.failed > 0) {
    await createAuditEvent({
      organizationId,
      actorUserId: options.actorUserId ?? null,
      actorEmail: options.actorEmail ?? null,
      action: "pta.volunteer_hours.deadline_reminders_sent",
      entityType: "pta_volunteer_requirement_period",
      entityId: periodId,
      metadata: { sent: result.sent, skippedNoContact: result.skippedNoContact, failed: result.failed },
    });
  }
  return result;
}

/** Assessment-posted notice: one email per newly POSTED charge in a batch.
 * Called as a best-effort follow-up from postAssessmentBatch — a
 * notification failure never rolls back or blocks the posting transaction
 * itself, since the assessment is already real and correctly obligated
 * regardless of whether the email goes out. */
export async function sendVolunteerHoursAssessmentPostedNotices(
  organizationId: string,
  batchId: string,
  options: { actorUserId?: string | null; actorEmail?: string | null } = {}
): Promise<NotificationRunResult> {
  const result = emptyResult(organizationId);

  const flagsOk = await requireVolunteerHoursFlag(organizationId, "notifications").catch(() => null);
  if (!flagsOk) return result;

  const access = await resolveOrganizationAccess(organizationId);
  if (!access.allowed) return result;

  const charges = await prisma.ptaVolunteerAssessmentCharge.findMany({
    where: { organizationId, batchId },
    select: { id: true, requirementPeriodId: true, householdId: true, amountCents: true, dueDate: true },
  });
  if (charges.length === 0) return result;

  const alreadySent = await prisma.ptaVolunteerNotificationLog.findMany({
    where: { organizationId, notificationType: "ASSESSMENT_POSTED", sourceId: { in: charges.map((c) => c.id) } },
    select: { sourceId: true },
  });
  const alreadySentIds = new Set(alreadySent.map((r) => r.sourceId));
  const candidates = charges.filter((c) => !alreadySentIds.has(c.id));
  if (candidates.length === 0) return result;

  const households = await prisma.ptaHousehold.findMany({
    where: { id: { in: candidates.map((c) => c.householdId) } },
    select: { id: true, primaryContact: { select: { name: true, email: true } } },
  });
  const householdById = new Map(households.map((h) => [h.id, h]));

  for (const charge of candidates) {
    const household = householdById.get(charge.householdId);
    const email = household?.primaryContact?.email?.trim();
    if (!email) {
      result.skippedNoContact += 1;
      continue;
    }
    try {
      await sendEmail({
        to: email,
        subject: "A remaining-hours assessment has been posted to your account",
        text: [
          `Hi ${household?.primaryContact?.name ?? "there"},`,
          "",
          `A volunteer-hours assessment of ${(charge.amountCents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })} has been posted to your family's account for hours not completed or purchased this period.`,
          ...(charge.dueDate ? [`Due: ${charge.dueDate.toLocaleDateString("en-US", { dateStyle: "long" })}`] : []),
          "",
          "Log in to your Unestra portal to review or pay this assessment.",
        ].join("\n"),
      });
      await logNotification({
        organizationId,
        requirementPeriodId: charge.requirementPeriodId,
        householdId: charge.householdId,
        notificationType: "ASSESSMENT_POSTED",
        sourceId: charge.id,
        recipientEmail: email,
      });
      result.sent += 1;
    } catch {
      result.failed += 1;
    }
  }

  if (result.sent > 0 || result.failed > 0) {
    await createAuditEvent({
      organizationId,
      actorUserId: options.actorUserId ?? null,
      actorEmail: options.actorEmail ?? null,
      action: "pta.volunteer_hours.assessment_posted_notices_sent",
      entityType: "pta_volunteer_assessment_batch",
      entityId: batchId,
      metadata: { sent: result.sent, skippedNoContact: result.skippedNoContact, failed: result.failed },
    });
  }
  return result;
}

/** Rate-change notice: one email per (household, pricing window) when a
 * window is about to start, for households still short on hours — lets a
 * family know the buyout rate is about to change before it does. */
export async function sendVolunteerHoursRateChangeNotices(
  organizationId: string,
  periodId: string,
  options: { lookaheadDays?: number; actorUserId?: string | null; actorEmail?: string | null } = {}
): Promise<NotificationRunResult> {
  const result = emptyResult(organizationId);

  const flagsOk = await requireVolunteerHoursFlag(organizationId, "notifications").catch(() => null);
  if (!flagsOk) return result;
  const buyoutOk = await requireVolunteerHoursFlag(organizationId, "buyout").catch(() => null);
  if (!buyoutOk) return result;

  const access = await resolveOrganizationAccess(organizationId);
  if (!access.allowed) return result;

  const period = await getVolunteerRequirementPeriod(organizationId, periodId).catch(() => null);
  if (!period || period.status !== "ACTIVE") return result;

  const lookaheadDays = options.lookaheadDays ?? DEFAULT_RATE_CHANGE_LOOKAHEAD_DAYS;
  const now = new Date();
  const lookaheadEnd = new Date(now.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);

  const windows = await listPricingWindows(organizationId, periodId);
  const upcoming = windows.filter((w) => w.active && w.startAt > now && w.startAt <= lookaheadEnd);
  if (upcoming.length === 0) return result;

  const contexts = await buildHouseholdReportContexts(organizationId, { requirementPeriodId: periodId });
  const notMet = contexts.filter((c) => !c.requirement.exempt && c.remainingMinutes > 0);
  if (notMet.length === 0) return result;

  const households = await prisma.ptaHousehold.findMany({
    where: { id: { in: notMet.map((c) => c.householdId) } },
    select: { id: true, primaryContact: { select: { name: true, email: true } } },
  });
  const householdById = new Map(households.map((h) => [h.id, h]));

  for (const window of upcoming) {
    const alreadySent = await prisma.ptaVolunteerNotificationLog.findMany({
      where: { organizationId, notificationType: "RATE_CHANGE_UPCOMING", sourceId: periodId, pricingWindowId: window.id },
      select: { householdId: true },
    });
    const alreadySentIds = new Set(alreadySent.map((r) => r.householdId));
    const candidates = notMet.filter((c) => !alreadySentIds.has(c.householdId));

    for (const ctx of candidates) {
      const household = householdById.get(ctx.householdId);
      const email = household?.primaryContact?.email?.trim();
      if (!email) {
        result.skippedNoContact += 1;
        continue;
      }
      try {
        await sendEmail({
          to: email,
          subject: `Volunteer-hour buyout pricing is changing — ${period.name}`,
          text: [
            `Hi ${household?.primaryContact?.name ?? "there"},`,
            "",
            `A new volunteer-hour buyout rate ("${window.name}") takes effect ${window.startAt.toLocaleDateString("en-US", { dateStyle: "long" })}.`,
            "If you're considering buying out remaining hours, you may want to do so before this change.",
            "",
            "Log in to your Unestra portal for current pricing and options.",
          ].join("\n"),
        });
        await logNotification({
          organizationId,
          requirementPeriodId: periodId,
          householdId: ctx.householdId,
          notificationType: "RATE_CHANGE_UPCOMING",
          sourceId: periodId,
          pricingWindowId: window.id,
          recipientEmail: email,
        });
        result.sent += 1;
      } catch {
        result.failed += 1;
      }
    }
  }

  if (result.sent > 0 || result.failed > 0) {
    await createAuditEvent({
      organizationId,
      actorUserId: options.actorUserId ?? null,
      actorEmail: options.actorEmail ?? null,
      action: "pta.volunteer_hours.rate_change_notices_sent",
      entityType: "pta_volunteer_requirement_period",
      entityId: periodId,
      metadata: { sent: result.sent, skippedNoContact: result.skippedNoContact, failed: result.failed },
    });
  }
  return result;
}

/** Cron sweep: deadline + rate-change notices for every ACTIVE period in
 * every organization that has ptaVolunteerNotificationsEnabled on. Assessment-
 * posted notices are NOT swept here — they're sent inline right after each
 * batch posts (see assessments.ts), since "a batch just posted" is an event,
 * not a recurring condition to poll for. */
export async function sendVolunteerHoursNotificationsAllOrganizations(): Promise<{ organizationsProcessed: number; totalSent: number }> {
  // Platform kill-switch checked here too, not just inside the per-org send
  // functions below — this sweep must fail closed BEFORE it queries or
  // iterates any organization, not just before it sends. Uses the same
  // centralized isPtaVolunteerHoursPlatformEnabled() every HTTP route
  // checks; never re-parses PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED itself.
  if (!isPtaVolunteerHoursPlatformEnabled()) {
    return { organizationsProcessed: 0, totalSent: 0 };
  }

  const profiles = await prisma.ptaProfile.findMany({
    where: { ptaVolunteerNotificationsEnabled: true, ptaVolunteerRequirementsEnabled: true },
    select: { organizationId: true },
  });

  // Pilot allowlist applied here, before any organization's data is
  // touched — not just relied upon inside sendVolunteerHoursFlag further
  // down (that check still runs too, defense-in-depth). An org whose stored
  // ptaVolunteerNotificationsEnabled/ptaVolunteerRequirementsEnabled flags
  // are still true from before it was removed from the allowlist (or that
  // never should have had them true) is filtered out here, before its
  // periods are even queried, not merely before a send.
  const allowlistedProfiles = profiles.filter((profile) => isPtaVolunteerHoursOrgAllowed(profile.organizationId));

  let totalSent = 0;
  for (const profile of allowlistedProfiles) {
    const periods = await listVolunteerRequirementPeriods(profile.organizationId);
    const activePeriods = periods.filter((p) => p.status === "ACTIVE");
    for (const period of activePeriods) {
      const deadlineResult = await sendVolunteerHoursDeadlineReminders(profile.organizationId, period.id);
      const rateChangeResult = await sendVolunteerHoursRateChangeNotices(profile.organizationId, period.id);
      totalSent += deadlineResult.sent + rateChangeResult.sent;
    }
  }
  return { organizationsProcessed: allowlistedProfiles.length, totalSent };
}

/**
 * Admin preview/test-send (spec: "admins can preview/test-send to approved
 * test recipients only"). Deliberately bypasses ptaVolunteerNotificationsEnabled
 * — that flag governs automated sends, not an admin explicitly testing the
 * feature before turning it on — but NEVER looks up a real household's
 * email; the recipient is always an address the caller supplies directly.
 * Still requires the platform kill-switch + the base requirements flag, so
 * a preview can't be sent for an org where this feature isn't even
 * provisioned at all.
 */
export async function previewVolunteerHoursNotification(
  organizationId: string,
  periodId: string,
  notificationType: "DEADLINE_REMINDER" | "ASSESSMENT_POSTED" | "RATE_CHANGE_UPCOMING",
  testRecipientEmail: string,
  actor: { userId: string; userEmail: string }
): Promise<void> {
  await requireVolunteerHoursFlag(organizationId, "requirements");
  const period = await getVolunteerRequirementPeriod(organizationId, periodId);
  const email = testRecipientEmail.trim();
  if (!email) throw new PtaError("PTA_VALIDATION_ERROR", "A test recipient email is required.");

  const subjectByType: Record<typeof notificationType, string> = {
    DEADLINE_REMINDER: `[TEST] Volunteer hours due soon — ${period.name}`,
    ASSESSMENT_POSTED: "[TEST] A remaining-hours assessment has been posted to your account",
    RATE_CHANGE_UPCOMING: `[TEST] Volunteer-hour buyout pricing is changing — ${period.name}`,
  };

  await sendEmail({
    to: email,
    subject: subjectByType[notificationType],
    text: [
      "This is a TEST notification sent by an administrator previewing the volunteer-hours notification templates.",
      "No real family received this message, and no real obligation exists.",
      "",
      `Notification type: ${notificationType}`,
      `Requirement period: ${period.name}`,
    ].join("\n"),
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "pta.volunteer_hours.notification_previewed",
    entityType: "pta_volunteer_requirement_period",
    entityId: periodId,
    metadata: { notificationType, testRecipientEmail: email },
  });
}
