import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mail";
import { createAuditEvent } from "@/lib/audit";

/**
 * PTA Vertical 2.0, PR PTA-G — volunteer shift reminders (brief §16). Emails
 * every SIGNED_UP volunteer whose slot starts inside the window and who has
 * not been reminded yet (reminderSentAt dedup — safe to run from the cron
 * sweep AND the officer "send now" button without double-sending).
 *
 * Deliberately email-only: every household adult has an optional email but
 * only a minority have linked portal accounts, so push would silently miss
 * most volunteers. Adults without an email are counted and reported, never
 * silently skipped.
 */

export interface ReminderRunResult {
  organizationId: string;
  sent: number;
  skippedNoEmail: number;
  failed: number;
}

const DEFAULT_WINDOW_HOURS = 48;

function formatWhen(startAt: Date | null): string {
  if (!startAt) return "soon";
  return startAt.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" });
}

export async function sendVolunteerRemindersForOrganization(
  organizationId: string,
  options: { windowHours?: number; actorUserId?: string | null; actorEmail?: string | null } = {}
): Promise<ReminderRunResult> {
  const windowHours = options.windowHours ?? DEFAULT_WINDOW_HOURS;
  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

  const signups = await prisma.ptaVolunteerSignup.findMany({
    where: {
      organizationId,
      status: "SIGNED_UP",
      reminderSentAt: null,
      slot: { startAt: { gte: now, lte: windowEnd }, status: { not: "CANCELLED" } },
    },
    include: {
      householdAdult: { select: { name: true, email: true } },
      slot: {
        select: {
          startAt: true,
          endAt: true,
          label: true,
          locationOverride: true,
          opportunity: { select: { title: true, instructions: true, organization: { select: { name: true } } } },
        },
      },
    },
    take: 500,
  });

  const result: ReminderRunResult = { organizationId, sent: 0, skippedNoEmail: 0, failed: 0 };

  for (const signup of signups) {
    const email = signup.householdAdult.email?.trim();
    if (!email) {
      result.skippedNoEmail += 1;
      continue;
    }
    const slot = signup.slot;
    const opportunity = slot.opportunity;
    const when = formatWhen(slot.startAt);
    try {
      await sendEmail({
        to: email,
        subject: `Volunteer reminder: ${opportunity.title} — ${when}`,
        text: [
          `Hi ${signup.householdAdult.name},`,
          "",
          `A reminder that you're signed up to volunteer for "${opportunity.title}"${slot.label ? ` (${slot.label})` : ""}.`,
          `When: ${when}`,
          ...(slot.locationOverride ? [`Where: ${slot.locationOverride}`] : []),
          ...(opportunity.instructions ? ["", opportunity.instructions] : []),
          "",
          `Thank you for volunteering with ${opportunity.organization.name}!`,
          "If you can no longer make it, please cancel your signup in the portal so someone else can take the spot.",
        ].join("\n"),
      });
      await prisma.ptaVolunteerSignup.update({ where: { id: signup.id }, data: { reminderSentAt: new Date() } });
      result.sent += 1;
    } catch {
      // Leave reminderSentAt null so the next run retries this volunteer.
      result.failed += 1;
    }
  }

  if (result.sent > 0 || result.failed > 0) {
    await createAuditEvent({
      organizationId,
      actorUserId: options.actorUserId ?? null,
      actorEmail: options.actorEmail ?? null,
      action: "pta.volunteers.reminders_sent",
      entityType: "pta_volunteer_signup",
      metadata: { sent: result.sent, skippedNoEmail: result.skippedNoEmail, failed: result.failed, windowHours },
    });
  }
  return result;
}

/** Cron sweep: every PTA organization with signups due in the window. */
export async function sendVolunteerRemindersAllOrganizations(options: { windowHours?: number } = {}) {
  const windowHours = options.windowHours ?? DEFAULT_WINDOW_HOURS;
  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

  const organizationRows = await prisma.ptaVolunteerSignup.findMany({
    where: { status: "SIGNED_UP", reminderSentAt: null, slot: { startAt: { gte: now, lte: windowEnd }, status: { not: "CANCELLED" } } },
    select: { organizationId: true },
    distinct: ["organizationId"],
    take: 100,
  });

  const runs: ReminderRunResult[] = [];
  for (const row of organizationRows) {
    runs.push(await sendVolunteerRemindersForOrganization(row.organizationId, { windowHours }));
  }
  return {
    organizations: runs.length,
    sent: runs.reduce((sum, run) => sum + run.sent, 0),
    skippedNoEmail: runs.reduce((sum, run) => sum + run.skippedNoEmail, 0),
    failed: runs.reduce((sum, run) => sum + run.failed, 0),
  };
}
