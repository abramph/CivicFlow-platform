import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { approveMeetingMinutes } from "@/lib/meeting-minutes";
import { requireRateLimit } from "@/lib/rate-limit";

/** meetings:minutes:approve, deliberately distinct from :review -- a reviewer who can request changes cannot also finalize the same minutes. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; minutesId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:meetings:minutes:approve", request, limit: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("meetings:minutes:approve", "throw");
    const { minutesId } = await params;

    const minutes = await approveMeetingMinutes({ organizationId, minutesId, actorUserId: session.userId });
    return Response.json({ ok: true, data: minutes });
  });
}
