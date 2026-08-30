import { PERMISSIONS } from "@/lib/rbac";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { buildFamilySummaryReportData } from "@/lib/labs/pta/volunteer-hours/reports/family-summary";
import { parseVolunteerReportFilters, resolveGeneratedByName } from "@/lib/labs/pta/volunteer-hours/reports/shared";

/** GET — Report A: Family Volunteer Summary, on-screen JSON (spec §11).
 * fix/pta-volunteer-financial-controls: dollar fields (buyout paid,
 * assessment, outstanding balance) are only included when this specific
 * caller holds the stricter financial-reports permission — everyone with
 * plain reports:view still gets the full operational/hours picture. */
export async function GET(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, can } = await requireVolunteerHoursAccess("pta:volunteer-reports:view", "reports");
    const { periodId } = await params;
    const filters = parseVolunteerReportFilters(new URL(request.url), periodId);
    const generatedByName = await resolveGeneratedByName(session.userId);
    const includeFinancials = can(PERMISSIONS.PTA_VOLUNTEER_FINANCIAL_REPORTS_VIEW);
    const data = await buildFamilySummaryReportData(organizationId, filters, generatedByName, includeFinancials);
    return Response.json({ ok: true, data });
  });
}
