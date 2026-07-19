import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { editMeetingMinutesDraft, getLatestMeetingMinutesDraft, getMeetingMinutesDraftHistory } from "@/lib/labs/meeting-intelligence/minutes-review";
import { MeetingIntelligenceError } from "@/lib/labs/meeting-intelligence/errors";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireMeetingIntelligenceAccess("meetingIntelligence:review");
    const { jobId } = await params;
    const { searchParams } = new URL(request.url);

    if (searchParams.get("history") === "1") {
      const history = await getMeetingMinutesDraftHistory(organizationId, jobId);
      return Response.json({ ok: true, data: history });
    }

    const draft = await getLatestMeetingMinutesDraft(organizationId, jobId);
    if (!draft) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "No minutes draft found for this job.");
    return Response.json({ ok: true, data: draft });
  });
}

// editableContent's exact shape is validated at the generator boundary
// (StructuredMeetingMinutes) — here we only require it to be a plain
// object; server-side code (editMeetingMinutesDraft) never trusts a
// client-supplied "status" field, so the draft's actual status can only
// ever change via the dedicated review/approve/reject endpoints below.
const editSchema = z.object({ editableContent: z.record(z.string(), z.unknown()) });

export async function PATCH(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireMeetingIntelligenceAccess("meetingIntelligence:review");
    const { jobId } = await params;
    const input = await parseJsonBody(request, editSchema);
    const draft = await editMeetingMinutesDraft({
      organizationId,
      jobId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      editableContent: input.editableContent as never,
    });
    return Response.json({ ok: true, data: draft });
  });
}
