import { withApiErrorHandling } from "@/lib/api-route";
import { cancelAssessmentBatch } from "@/lib/labs/pta/volunteer-hours/assessments";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";

export async function POST(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-assessments:preview-post", "assessments");
    const { batchId } = await params;
    await cancelAssessmentBatch(organizationId, batchId, { userId: session.userId });
    return Response.json({ ok: true });
  });
}
