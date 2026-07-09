import { withApiErrorHandling } from "@/lib/api-route";
import { validateCronSecret } from "@/lib/cron-auth";
import { requireRateLimit } from "@/lib/rate-limit";
import { processRetryableSmsMessages } from "@/lib/sms-queue";

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
    const result = await processRetryableSmsMessages();
    return Response.json({ ok: true, processed: result.processed });
  });
}
