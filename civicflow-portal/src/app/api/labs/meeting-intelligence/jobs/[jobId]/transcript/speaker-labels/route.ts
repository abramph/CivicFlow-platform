import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { renameMeetingIntelligenceSpeakerLabels } from "@/lib/labs/meeting-intelligence/transcript";
import { parseJsonBody, z } from "@/lib/validation";

const schema = z.object({ labelMap: z.record(z.string().min(1).max(100), z.string().min(1).max(200)) });

export async function PATCH(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireMeetingIntelligenceAccess("meetingIntelligence:review");
    const { jobId } = await params;
    const input = await parseJsonBody(request, schema);
    const transcript = await renameMeetingIntelligenceSpeakerLabels({
      organizationId,
      jobId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      labelMap: input.labelMap,
    });
    return Response.json({ ok: true, data: transcript });
  });
}
