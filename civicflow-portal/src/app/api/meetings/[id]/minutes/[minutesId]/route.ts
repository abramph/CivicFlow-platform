import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { editMeetingMinutesDraft } from "@/lib/meeting-minutes";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const editSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  bodyText: z.string().trim().min(1).max(20000).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; minutesId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:meetings:minutes:write", request, limit: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("meetings:write", "throw");
    const { minutesId } = await params;
    const input = await parseJsonBody(request, editSchema);

    const minutes = await editMeetingMinutesDraft({
      organizationId,
      minutesId,
      title: input.title,
      bodyText: input.bodyText,
      actorUserId: session.userId,
    });
    return Response.json({ ok: true, data: minutes });
  });
}
