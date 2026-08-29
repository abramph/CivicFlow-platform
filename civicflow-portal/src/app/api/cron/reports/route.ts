import { withApiErrorHandling } from "@/lib/api-route";
import { validateReportExportCronSecret } from "@/lib/cron-auth";
import { requireRateLimit } from "@/lib/rate-limit";
import { processQueuedReportExports } from "@/lib/reports";

/**
 * fix/report-export-queue-hardening: authenticates with
 * REPORT_EXPORT_CRON_SECRET only — never the shared CRON_SECRET the other
 * 11 cron routes use (see cron-auth.ts). Bounded batch + bounded cleanup
 * sweep per call, both independently safe to call with zero eligible rows,
 * and safe under concurrent/overlapping calls (the atomic claim in
 * claimReportExportBatch is what makes that true, not anything here).
 * Response is a sanitized count-only summary — never organization data,
 * object keys, error text, or report contents, so this endpoint can't leak
 * anything even if the bearer secret were somehow guessed by something
 * short of a full compromise.
 */
const BATCH_SIZE = 10;
const CLEANUP_BATCH_SIZE = 25;

export async function POST(request: Request) {
  const limited = await requireRateLimit({
    scope: "api:cron",
    request,
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  if (!validateReportExportCronSecret(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return withApiErrorHandling(async () => {
    const result = await processQueuedReportExports(BATCH_SIZE, CLEANUP_BATCH_SIZE);
    return Response.json({
      ok: true,
      processed: result.processed,
      cleanupChecked: result.cleanupChecked,
      cleanupDeleted: result.cleanupDeleted,
    });
  });
}
