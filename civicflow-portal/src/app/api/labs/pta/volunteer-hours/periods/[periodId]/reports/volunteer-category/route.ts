import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseVolunteerReportFilters, resolveGeneratedByName } from "@/lib/labs/pta/volunteer-hours/reports/shared";
import { buildVolunteerCategoryReportData } from "@/lib/labs/pta/volunteer-hours/reports/volunteer-category";

/** GET — Report G: Volunteer Category Report, on-screen JSON. */
export async function GET(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-reports:view", "reports");
    const { periodId } = await params;
    const filters = parseVolunteerReportFilters(new URL(request.url), periodId);
    const generatedByName = await resolveGeneratedByName(session.userId);
    const data = await buildVolunteerCategoryReportData(organizationId, filters, generatedByName);
    return Response.json({ ok: true, data });
  });
}
