import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { getMeetingMinutesVersions, createMeetingMinutesDraft } from "@/lib/meeting-minutes";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const createSchema = z.object({
  title: z.string().trim().min(1).max(255),
  bodyText: z.string().trim().min(1).max(20000),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("meetings:read", "throw");
    const { id } = await params;
    const versions = await getMeetingMinutesVersions({ organizationId, meetingId: id });
    return Response.json({ ok: true, data: versions });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:meetings:minutes:write", request, limit: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("meetings:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, createSchema);

    const minutes = await createMeetingMinutesDraft({
      organizationId,
      meetingId: id,
      title: input.title,
      bodyText: input.bodyText,
      actorUserId: session.userId,
    });
    return Response.json({ ok: true, data: minutes }, { status: 201 });
  });
}
