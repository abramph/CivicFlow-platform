import { withApiErrorHandling } from "@/lib/api-route";
import { postAssessmentBatch } from "@/lib/labs/pta/volunteer-hours/assessments";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";

/** POST — confirm-and-post: creates one obligation + ledger entry per
 * included family, atomically, duplicate-post-proof (spec §18). */
export async function POST(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-assessments:preview-post", "assessments");
    const { batchId } = await params;
    const result = await postAssessmentBatch(organizationId, batchId, { userId: session.userId, userEmail: session.userEmail });
    return Response.json({ ok: true, data: result.charges, batchFullyPosted: result.batchFullyPosted, remainingLineCount: result.remainingLineCount });
  });
}
