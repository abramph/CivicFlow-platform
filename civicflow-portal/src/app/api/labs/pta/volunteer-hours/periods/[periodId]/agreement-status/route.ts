import { PERMISSIONS } from "@/lib/rbac";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { getAgreementStatusCounts } from "@/lib/labs/pta/volunteer-hours/agreements";

export async function GET(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireVolunteerHoursAccess(PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_VIEW, "requirements");
    const { periodId } = await params;
    const counts = await getAgreementStatusCounts(organizationId, periodId);
    return Response.json({ ok: true, data: counts });
  });
}
