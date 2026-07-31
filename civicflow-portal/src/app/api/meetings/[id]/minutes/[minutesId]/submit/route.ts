import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { submitMeetingMinutesForReview } from "@/lib/meeting-minutes";
import { requireRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; minutesId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:meetings:minutes:write", request, limit: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("meetings:write", "throw");
    const { minutesId } = await params;

    const minutes = await submitMeetingMinutesForReview({ organizationId, minutesId, actorUserId: session.userId });
    return Response.json({ ok: true, data: minutes });
  });
}
