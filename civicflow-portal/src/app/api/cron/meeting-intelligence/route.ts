import { withApiErrorHandling } from "@/lib/api-route";
import { processMeetingIntelligenceQueue } from "@/lib/labs/meeting-intelligence/worker";
import { validateCronSecret } from "@/lib/cron-auth";
import { requireRateLimit } from "@/lib/rate-limit";

/**
 * Processes Meeting Intelligence jobs: submits QUEUED jobs to the
 * transcription provider, and polls TRANSCRIBING jobs for completion
 * (generating draft minutes once a transcript is ready). Same
 * CRON_SECRET bearer-auth pattern as cron/campaigns, cron/reminders.
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
    const result = await processMeetingIntelligenceQueue();
    return Response.json({ ok: true, ...result });
  });
}
