import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { deleteMeetingIntelligenceRecording } from "@/lib/labs/meeting-intelligence/jobs";

/** Requires meetingIntelligence:delete — a stricter permission than read/create/review. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireMeetingIntelligenceAccess("meetingIntelligence:delete");
    const { jobId } = await params;
    const job = await deleteMeetingIntelligenceRecording({ organizationId, jobId, actorUserId: session.userId, actorEmail: session.userEmail });
    return Response.json({ ok: true, data: job });
  });
}
