import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { sendVolunteerHoursDeadlineReminders } from "@/lib/labs/pta/volunteer-hours/notifications";

/** POST — officer "send deadline reminders now" for this period. Dedup via
 * PtaVolunteerNotificationLog makes this safe alongside the cron sweep;
 * requires ptaVolunteerNotificationsEnabled (this is a real send, not a
 * preview). */
export async function POST(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-requirements:manage", "notifications");
    const { periodId } = await params;
    const result = await sendVolunteerHoursDeadlineReminders(organizationId, periodId, {
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: result });
  });
}
