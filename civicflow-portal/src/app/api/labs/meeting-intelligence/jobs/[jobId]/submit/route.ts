import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { submitMeetingIntelligenceJob } from "@/lib/labs/meeting-intelligence/jobs";

/** Explicit server-side confirmation after upload, before processing begins. */
export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireMeetingIntelligenceAccess("meetingIntelligence:create");
    const { jobId } = await params;
    const job = await submitMeetingIntelligenceJob({ organizationId, jobId, actorUserId: session.userId, actorEmail: session.userEmail });
    return Response.json({ ok: true, data: job });
  });
}
