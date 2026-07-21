import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { submitMeetingIntelligenceFeedback, listMeetingIntelligenceFeedbackForJob } from "@/lib/labs/meeting-intelligence/feedback";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  overallRating: z.number().int().min(1).max(5),
  transcriptionQualityRating: z.number().int().min(1).max(5).nullable().optional(),
  speakerLabelQualityRating: z.number().int().min(1).max(5).nullable().optional(),
  minutesAccuracyRating: z.number().int().min(1).max(5).nullable().optional(),
  timeSavedMinutes: z.number().min(0).nullable().optional(),
  correctionsRequired: z.boolean().nullable().optional(),
  issueCategory: z.string().max(64).nullable().optional(),
  comments: z.string().max(4000).nullable().optional(),
});

/** Submitting feedback implies having reviewed the job's output — gated by the same permission as the review action. */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireMeetingIntelligenceAccess("meetingIntelligence:review");
    const { jobId } = await params;
    const input = await parseJsonBody(request, bodySchema);

    const feedback = await submitMeetingIntelligenceFeedback({
      organizationId,
      jobId,
      actorUserId: session.userId,
      ...input,
    });
    return Response.json({ ok: true, data: feedback });
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireMeetingIntelligenceAccess("meetingIntelligence:review");
    const { jobId } = await params;
    const items = await listMeetingIntelligenceFeedbackForJob(organizationId, jobId);
    return Response.json({ ok: true, data: items });
  });
}
