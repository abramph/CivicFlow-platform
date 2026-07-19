import { withApiErrorHandling } from "@/lib/api-route";
import { runMeetingIntelligenceRetentionCleanup } from "@/lib/labs/meeting-intelligence/retention";
import { validateCronSecret } from "@/lib/cron-auth";
import { requireRateLimit } from "@/lib/rate-limit";

/** Deletes source recordings past their retention window — never transcripts or minutes. See retention.ts. */
export async function POST(request: Request) {
  const limited = await requireRateLimit({ scope: "api:cron", request, limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  if (!validateCronSecret(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return withApiErrorHandling(async () => {
    const result = await runMeetingIntelligenceRetentionCleanup();
    return Response.json({ ok: true, ...result });
  });
}
