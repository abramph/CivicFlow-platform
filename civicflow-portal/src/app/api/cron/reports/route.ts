import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { processQueuedReportExports } from "@/lib/reports";

function validateCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

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
    const result = await processQueuedReportExports(50);
    return Response.json({ ok: true, processed: result.processed });
  });
}
