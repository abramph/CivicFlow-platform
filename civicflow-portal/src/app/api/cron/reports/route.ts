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
 *
 * Rate-limit scope (follow-up review finding): the other 11 cron routes
 * all share the literal scope string "api:cron", meaning traffic to ANY of
 * them from the same apparent client IP shares one bucket — unauthenticated
 * requests to, say, /api/cron/campaigns could exhaust the quota this route
 * also relied on, before the real scheduler's call ever arrives. This
 * route uses its own dedicated scope so it can never be starved by traffic
 * aimed at a different endpoint. The limit itself stays deliberately
 * generous (well above any realistic legitimate cadence — a 5-minute-
 * interval scheduler needs 1 request per window) specifically so it "cannot
 * lock out the legitimate scheduler" even under a same-IP flood — the real
 * gate is REPORT_EXPORT_CRON_SECRET below, not this. This check runs first
 * only because it's cheap (no DB round-trip) and rejects obviously-abusive
 * volume before spending a timing-safe comparison on it; it is not the
 * route's actual security boundary.
 */
const BATCH_SIZE = 10;
const CLEANUP_BATCH_SIZE = 25;
const RATE_LIMIT_SCOPE = "api:cron:reports";
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function POST(request: Request) {
  const limited = await requireRateLimit({
    scope: RATE_LIMIT_SCOPE,
    request,
    limit: RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
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
      artifactCleanupChecked: result.artifactCleanupChecked,
      artifactCleanupCleaned: result.artifactCleanupCleaned,
    });
  });
}
