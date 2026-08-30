import { PERMISSIONS } from "@/lib/rbac";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { archiveAgreementVersion } from "@/lib/labs/pta/volunteer-hours/agreements";

export async function POST(_request: Request, { params }: { params: Promise<{ periodId: string; versionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess(PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_MANAGE, "requirements");
    const { versionId } = await params;
    const archived = await archiveAgreementVersion(organizationId, versionId, { userId: session.userId, userEmail: session.userEmail });
    return Response.json({ ok: true, data: archived });
  });
}
