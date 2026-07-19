import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { regenerateMeetingMinutesDraft } from "@/lib/labs/meeting-intelligence/minutes-review";
import { estimateGenerationCostCents } from "@/lib/labs/meeting-intelligence/cost-constants";
import { recordMinutesGenerationJob } from "@/lib/labs/meeting-intelligence/usage";

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireMeetingIntelligenceAccess("meetingIntelligence:review");
    const { jobId } = await params;
    const draft = await regenerateMeetingMinutesDraft({ organizationId, jobId, actorUserId: session.userId, actorEmail: session.userEmail });
    await recordMinutesGenerationJob(organizationId, jobId, draft.generatedByProvider ?? "unknown", estimateGenerationCostCents());
    return Response.json({ ok: true, data: draft });
  });
}
