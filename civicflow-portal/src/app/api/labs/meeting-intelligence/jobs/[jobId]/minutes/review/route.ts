import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { requestMeetingMinutesReview } from "@/lib/labs/meeting-intelligence/minutes-review";

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireMeetingIntelligenceAccess("meetingIntelligence:review");
    const { jobId } = await params;
    const draft = await requestMeetingMinutesReview({ organizationId, jobId, actorUserId: session.userId, actorEmail: session.userEmail });
    return Response.json({ ok: true, data: draft });
  });
}
