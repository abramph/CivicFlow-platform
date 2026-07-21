import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { runMeetingIntelligenceLiveDiagnostics } from "@/lib/platform-operations/meeting-intelligence";

/**
 * Explicit, admin-triggered live reachability checks — never run
 * automatically on page load. Never submits audio, never performs billable
 * transcription, never returns a credential value (see
 * runMeetingIntelligenceLiveDiagnostics's own doc comment).
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:admin:meeting-intelligence:diagnostics",
      request,
      limit: 10,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    await requireSuperAdmin("throw");
    const results = await runMeetingIntelligenceLiveDiagnostics();
    return Response.json({ ok: true, data: results });
  });
}
