import { withApiErrorHandling } from "@/lib/api-route";
import { validateCronSecret } from "@/lib/cron-auth";
import { requireRateLimit } from "@/lib/rate-limit";
import { sendVolunteerHoursNotificationsAllOrganizations } from "@/lib/labs/pta/volunteer-hours/notifications";

/**
 * Volunteer Hour Requirements & Buyout program, VH-L (docs/pta-volunteer-hours.md).
 * Deadline + rate-change notice sweep across every org with
 * ptaVolunteerNotificationsEnabled on (off by default). Same CRON_SECRET
 * bearer-auth pattern as /api/cron/volunteer-reminders; PtaVolunteerNotificationLog
 * dedup makes repeated invocations safe. Not registered with any external
 * scheduler as part of this program — wiring the actual cron schedule is a
 * Phase 2 rollout/ops step, done only once you explicitly authorize it.
 */
export async function POST(request: Request) {
  const limited = await requireRateLimit({
    scope: "api:cron",
    request,
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  if (!validateCronSecret(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return withApiErrorHandling(async () => {
    const result = await sendVolunteerHoursNotificationsAllOrganizations();
    return Response.json({ ok: true, ...result });
  });
}
