import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { requestMeetingMinutesChanges } from "@/lib/meeting-minutes";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const requestChangesSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string; minutesId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:meetings:minutes:review", request, limit: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("meetings:minutes:review", "throw");
    const { minutesId } = await params;
    const input = await parseJsonBody(request, requestChangesSchema);

    const minutes = await requestMeetingMinutesChanges({
      organizationId,
      minutesId,
      actorUserId: session.userId,
      reason: input.reason,
    });
    return Response.json({ ok: true, data: minutes });
  });
}
