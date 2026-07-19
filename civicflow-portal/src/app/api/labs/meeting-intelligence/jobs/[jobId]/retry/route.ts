import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { retryMeetingIntelligenceJob } from "@/lib/labs/meeting-intelligence/jobs";

/** Retries a FAILED job — bounded and explicit, never automatic. */
export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireMeetingIntelligenceAccess("meetingIntelligence:create");
    const { jobId } = await params;
    const job = await retryMeetingIntelligenceJob({ organizationId, jobId, actorUserId: session.userId, actorEmail: session.userEmail });
    return Response.json({ ok: true, data: job });
  });
}
