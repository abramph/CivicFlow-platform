import { withApiErrorHandling } from "@/lib/api-route";
import { validateCronSecret } from "@/lib/cron-auth";
import { requireRateLimit } from "@/lib/rate-limit";
import { sendVolunteerRemindersAllOrganizations } from "@/lib/labs/pta/volunteer-reminders";

/**
 * PTA-G — pre-shift volunteer reminder sweep across every PTA organization.
 * Same CRON_SECRET bearer-auth pattern as the other /api/cron routes;
 * reminderSentAt dedup makes repeated invocations safe.
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
    const result = await sendVolunteerRemindersAllOrganizations();
    return Response.json({ ok: true, ...result });
  });
}
