import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { approveMeetingMinutesDraft } from "@/lib/labs/meeting-intelligence/minutes-review";

/** Requires meetingIntelligence:approve — distinct from :review, so a reviewer without approval authority cannot finalize minutes. */
export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireMeetingIntelligenceAccess("meetingIntelligence:approve");
    const { jobId } = await params;
    const draft = await approveMeetingMinutesDraft({ organizationId, jobId, actorUserId: session.userId, actorEmail: session.userEmail });
    return Response.json({ ok: true, data: draft });
  });
}
