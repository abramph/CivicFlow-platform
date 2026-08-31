import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { buildFamilyAgreementStatusReportData } from "@/lib/labs/pta/volunteer-hours/reports/family-agreement-status";
import { parseVolunteerReportFilters, resolveGeneratedByName } from "@/lib/labs/pta/volunteer-hours/reports/shared";

/** GET — Report H: Family Agreement Status Report, on-screen JSON.
 * Ordinary pta:volunteer-reports:view/"reports" capability gate — this
 * report carries no dollar figures, so unlike Report E (and Reports A/D's
 * optional financial columns) it needs no additional financial-permission
 * check. Always scoped to the requirementPeriodId in the URL; this report
 * has no ALL_TIME mode. */
export async function GET(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-reports:view", "reports");
    const { periodId } = await params;
    const url = new URL(request.url);
    const filters = parseVolunteerReportFilters(url, periodId);
    const generatedByName = await resolveGeneratedByName(session.userId);
    const data = await buildFamilyAgreementStatusReportData(organizationId, filters, generatedByName);
    return Response.json({ ok: true, data });
  });
}
