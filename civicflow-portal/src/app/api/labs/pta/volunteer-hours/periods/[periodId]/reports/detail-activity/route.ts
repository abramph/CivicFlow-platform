import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { buildDetailActivityReportData } from "@/lib/labs/pta/volunteer-hours/reports/detail-activity";
import { parseVolunteerReportFilters, resolveGeneratedByName } from "@/lib/labs/pta/volunteer-hours/reports/shared";

/** GET — Report B: Detailed Family Volunteer Activity, on-screen JSON (spec §11). */
export async function GET(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-reports:view", "reports");
    const { periodId } = await params;
    const filters = parseVolunteerReportFilters(new URL(request.url), periodId);
    const generatedByName = await resolveGeneratedByName(session.userId);
    const data = await buildDetailActivityReportData(organizationId, filters, generatedByName);
    return Response.json({ ok: true, data });
  });
}
