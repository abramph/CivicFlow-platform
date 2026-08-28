import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { buildFinancialReportData } from "@/lib/labs/pta/volunteer-hours/reports/financial";
import { parseVolunteerReportFilters, resolveGeneratedByName } from "@/lib/labs/pta/volunteer-hours/reports/shared";

/** GET — Report E: Purchased-Hours & Financial Report, on-screen JSON.
 * Gated on pta:volunteer-financial-reports:view — the one report in this
 * program that requires the stricter financial permission, not the general
 * reports permission Reports A-D/F/G use (spec: money-sensitive). */
export async function GET(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-financial-reports:view", "reports");
    const { periodId } = await params;
    const filters = parseVolunteerReportFilters(new URL(request.url), periodId);
    const generatedByName = await resolveGeneratedByName(session.userId);
    const data = await buildFinancialReportData(organizationId, filters, generatedByName);
    return Response.json({ ok: true, data });
  });
}
