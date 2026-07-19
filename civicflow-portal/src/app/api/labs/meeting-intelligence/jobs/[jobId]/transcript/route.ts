import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { getMeetingIntelligenceTranscript } from "@/lib/labs/meeting-intelligence/transcript";
import { deleteMeetingIntelligenceTranscript } from "@/lib/labs/meeting-intelligence/jobs";
import { MeetingIntelligenceError } from "@/lib/labs/meeting-intelligence/errors";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireMeetingIntelligenceAccess("meetingIntelligence:review");
    const { jobId } = await params;
    const transcript = await getMeetingIntelligenceTranscript(organizationId, jobId);
    if (!transcript) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "Transcript not found for this job.");
    return Response.json({ ok: true, data: transcript });
  });
}

const deleteSchema = z.object({ acknowledgeRegenerationImpossible: z.literal(true) });

/** Requires an explicit acknowledgement in the request body before deleting — see consent.ts's fail-closed pattern. */
export async function DELETE(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireMeetingIntelligenceAccess("meetingIntelligence:delete");
    const { jobId } = await params;
    const input = await parseJsonBody(request, deleteSchema);
    await deleteMeetingIntelligenceTranscript({
      organizationId,
      jobId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      acknowledgeRegenerationImpossible: input.acknowledgeRegenerationImpossible,
    });
    return Response.json({ ok: true });
  });
}
