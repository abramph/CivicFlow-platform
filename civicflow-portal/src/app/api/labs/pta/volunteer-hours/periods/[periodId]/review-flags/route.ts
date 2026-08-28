import { withApiErrorHandling } from "@/lib/api-route";
import { listReviewFlags } from "@/lib/labs/pta/volunteer-hours/corrections";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";

export async function GET(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireVolunteerHoursAccess("pta:volunteer-requirements:view", "requirements");
    const { periodId } = await params;
    const flags = await listReviewFlags(organizationId, periodId);
    return Response.json({ ok: true, data: flags });
  });
}
