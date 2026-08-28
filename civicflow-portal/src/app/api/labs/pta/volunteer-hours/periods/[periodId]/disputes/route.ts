import { withApiErrorHandling } from "@/lib/api-route";
import { listPeriodDisputes } from "@/lib/labs/pta/volunteer-hours/disputes";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";

export async function GET(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireVolunteerHoursAccess("pta:volunteer-requirements:view", "requirements");
    const { periodId } = await params;
    const disputes = await listPeriodDisputes(organizationId, periodId);
    return Response.json({ ok: true, data: disputes });
  });
}
