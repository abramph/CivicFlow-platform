import { withApiErrorHandling } from "@/lib/api-route";
import { processImportQueue } from "@/lib/imports/engine";
import { validateCronSecret } from "@/lib/cron-auth";
import { requireRateLimit } from "@/lib/rate-limit";

/**
 * Resumable Import Program (PR A) — processes import batches: analyzes
 * UPLOADED batches (parses the retained file, classifies rows) and advances
 * IMPORTING batches by one bounded tick (writing eligible rows, pausing at
 * a plan limit if one is hit). Same CRON_SECRET bearer-auth pattern as
 * cron/campaigns, cron/meeting-intelligence.
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
    const result = await processImportQueue();
    return Response.json({ ok: true, ...result });
  });
}
