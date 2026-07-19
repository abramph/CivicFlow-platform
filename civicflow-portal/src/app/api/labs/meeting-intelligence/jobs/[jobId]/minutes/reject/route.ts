import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { rejectMeetingMinutesDraft } from "@/lib/labs/meeting-intelligence/minutes-review";
import { parseJsonBody, z } from "@/lib/validation";

const schema = z.object({ reason: z.string().max(2000).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireMeetingIntelligenceAccess("meetingIntelligence:review");
    const { jobId } = await params;
    const input = await parseJsonBody(request, schema);
    const draft = await rejectMeetingMinutesDraft({
      organizationId,
      jobId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      reason: input.reason,
    });
    return Response.json({ ok: true, data: draft });
  });
}
