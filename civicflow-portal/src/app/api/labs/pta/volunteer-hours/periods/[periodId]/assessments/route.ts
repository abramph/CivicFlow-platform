import { withApiErrorHandling } from "@/lib/api-route";
import { listAssessmentBatches, previewAssessmentBatch } from "@/lib/labs/pta/volunteer-hours/assessments";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireVolunteerHoursAccess("pta:volunteer-assessments:preview-post", "assessments");
    const { periodId } = await params;
    const batches = await listAssessmentBatches(organizationId, periodId);
    return Response.json({ ok: true, data: batches });
  });
}

const bodySchema = z.object({ supersedesBatchId: z.string().min(1).nullable().optional() });

/** POST — preview: pure computation, zero obligations created (spec §18). */
export async function POST(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-assessments:preview-post", "assessments");
    const { periodId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const batch = await previewAssessmentBatch(organizationId, periodId, { userId: session.userId }, input);
    return Response.json({ ok: true, data: batch }, { status: 201 });
  });
}
