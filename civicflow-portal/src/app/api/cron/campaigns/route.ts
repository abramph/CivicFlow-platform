import { withApiErrorHandling } from "@/lib/api-route";
import { processScheduledCampaigns } from "@/lib/communication-campaigns";
import { validateCronSecret } from "@/lib/cron-auth";
import { requireRateLimit } from "@/lib/rate-limit";

/**
 * Fires scheduled communication campaigns (dues reminders, announcements,
 * etc.) whose scheduledFor time has passed. Same CRON_SECRET bearer-auth
 * pattern as cron/reminders.
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
    const result = await processScheduledCampaigns(100);
    return Response.json({ ok: true, ...result });
  });
}
