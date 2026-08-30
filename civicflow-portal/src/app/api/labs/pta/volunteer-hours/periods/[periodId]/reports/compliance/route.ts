import { PERMISSIONS } from "@/lib/rbac";
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

/** GET — Report D: Volunteer Requirement Compliance Report, on-screen JSON (spec §11).
 * RV-12: `estimatedFinalAssessmentCents` (row) and `totalAssessmentsCents`
 * (summary) are real dollar figures, gated the same way Report A's dollar
 * fields are — only included for a caller who specifically holds
 * pta:volunteer-financial-reports:view, not merely pta:volunteer-reports:view
 * (which STAFF/READ_ONLY both hold). Found unconditionally leaking during
 * RV-12's re-verification; fixed here identically to FC-3's Report A fix. */
export async function GET(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, can } = await requireVolunteerHoursAccess("pta:volunteer-reports:view", "reports");
    const { periodId } = await params;
    const url = new URL(request.url);
    const filters = parseVolunteerReportFilters(url, periodId);
    const complianceFilterParam = url.searchParams.get("complianceFilter");
    const complianceFilter =
      complianceFilterParam && COMPLIANCE_FILTERS.has(complianceFilterParam as ComplianceFilter) ? (complianceFilterParam as ComplianceFilter) : undefined;
    const generatedByName = await resolveGeneratedByName(session.userId);
    const includeFinancials = can(PERMISSIONS.PTA_VOLUNTEER_FINANCIAL_REPORTS_VIEW);
    const data = await buildComplianceReportData(organizationId, { ...filters, complianceFilter }, generatedByName, includeFinancials);
    return Response.json({ ok: true, data });
  });
}
