import { withApiErrorHandling } from "@/lib/api-route";
import { resolveHourDispute } from "@/lib/labs/pta/volunteer-hours/disputes";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  status: z.enum(["RESOLVED", "DISMISSED"]),
  adminNotes: z.string().max(4000).nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ disputeId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-requirements:manage", "requirements");
    const { disputeId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const dispute = await resolveHourDispute(organizationId, disputeId, input.status, input.adminNotes ?? null, session.userId);
    return Response.json({ ok: true, data: dispute });
  });
}
