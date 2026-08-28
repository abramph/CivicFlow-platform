import { withApiErrorHandling } from "@/lib/api-route";
import { excludeAssessmentLine, includeAssessmentLine } from "@/lib/labs/pta/volunteer-hours/assessments";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  status: z.enum(["INCLUDED", "EXCLUDED"]),
  reason: z.string().max(2000).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ batchId: string; lineId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-assessments:preview-post", "assessments");
    const { batchId, lineId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const line =
      input.status === "EXCLUDED"
        ? await excludeAssessmentLine(organizationId, batchId, lineId, input.reason ?? "", { userId: session.userId })
        : await includeAssessmentLine(organizationId, batchId, lineId, { userId: session.userId });
    return Response.json({ ok: true, data: line });
  });
}
