import { withApiErrorHandling } from "@/lib/api-route";
import { previewPeriodAssignments } from "@/lib/labs/pta/volunteer-hours/assignments";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";

/** GET /api/labs/pta/volunteer-hours/periods/:id/preview — the full
 * per-family requirement table an admin should review before flipping a
 * period Draft→Active (spec §4: "show administrators a preview of the
 * requirement that will be assigned to each family"). */
export async function GET(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireVolunteerHoursAccess("pta:volunteer-requirements:view", "requirements");
    const { periodId } = await params;
    const preview = await previewPeriodAssignments(organizationId, periodId);
    return Response.json({ ok: true, data: preview });
  });
}
