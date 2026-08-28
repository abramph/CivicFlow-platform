import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { buildComplianceReportData, type ComplianceFilter } from "@/lib/labs/pta/volunteer-hours/reports/compliance";
import { parseVolunteerReportFilters, resolveGeneratedByName } from "@/lib/labs/pta/volunteer-hours/reports/shared";

const COMPLIANCE_FILTERS = new Set<ComplianceFilter>([
  "MET",
  "NOT_MET",
  "NO_HOURS",
  "PENDING",
  "ELIGIBLE_FOR_BUYOUT",
  "SUBJECT_TO_ASSESSMENT",
  "EXEMPT",
]);

/** GET — Report D: Volunteer Requirement Compliance Report, on-screen JSON (spec §11). */
export async function GET(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-reports:view", "reports");
    const { periodId } = await params;
    const url = new URL(request.url);
    const filters = parseVolunteerReportFilters(url, periodId);
    const complianceFilterParam = url.searchParams.get("complianceFilter");
    const complianceFilter =
      complianceFilterParam && COMPLIANCE_FILTERS.has(complianceFilterParam as ComplianceFilter) ? (complianceFilterParam as ComplianceFilter) : undefined;
    const generatedByName = await resolveGeneratedByName(session.userId);
    const data = await buildComplianceReportData(organizationId, { ...filters, complianceFilter }, generatedByName);
    return Response.json({ ok: true, data });
  });
}
