import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { buildIndividualVolunteerReportData } from "@/lib/labs/pta/volunteer-hours/reports/individual-volunteer";
import { parseVolunteerReportFilters, resolveGeneratedByName } from "@/lib/labs/pta/volunteer-hours/reports/shared";

/** GET — Report F: Individual Volunteer Report, on-screen JSON. */
export async function GET(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-reports:view", "reports");
    const { periodId } = await params;
    const filters = parseVolunteerReportFilters(new URL(request.url), periodId);
    const generatedByName = await resolveGeneratedByName(session.userId);
    const data = await buildIndividualVolunteerReportData(organizationId, filters, generatedByName);
    return Response.json({ ok: true, data });
  });
}
