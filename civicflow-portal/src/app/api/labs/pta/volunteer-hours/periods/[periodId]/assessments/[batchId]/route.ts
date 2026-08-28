import { withApiErrorHandling } from "@/lib/api-route";
import { getAssessmentBatch } from "@/lib/labs/pta/volunteer-hours/assessments";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";

export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireVolunteerHoursAccess("pta:volunteer-assessments:preview-post", "assessments");
    const { batchId } = await params;
    const batch = await getAssessmentBatch(organizationId, batchId);
    return Response.json({ ok: true, data: batch });
  });
}
