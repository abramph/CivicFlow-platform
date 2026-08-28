import { withApiErrorHandling } from "@/lib/api-route";
import { resolveReviewFlag } from "@/lib/labs/pta/volunteer-hours/corrections";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ resolutionNotes: z.string().max(2000).nullable().optional() });

export async function POST(request: Request, { params }: { params: Promise<{ flagId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-requirements:manage", "requirements");
    const { flagId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const flag = await resolveReviewFlag(organizationId, flagId, input.resolutionNotes ?? null, { userId: session.userId });
    return Response.json({ ok: true, data: flag });
  });
}
