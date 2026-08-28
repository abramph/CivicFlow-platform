import { createAuditEvent } from "@/lib/audit";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { buildComplianceReportData, COMPLIANCE_COLUMNS, type ComplianceFilter } from "@/lib/labs/pta/volunteer-hours/reports/compliance";
import { parseVolunteerReportFilters, resolveGeneratedByName } from "@/lib/labs/pta/volunteer-hours/reports/shared";
import { buildReportFilename, buildVolunteerReportWorkbook } from "@/lib/labs/pta/volunteer-hours/reports/xlsx-builder";

const COMPLIANCE_FILTERS = new Set<ComplianceFilter>([
  "MET",
  "NOT_MET",
  "NO_HOURS",
  "PENDING",
  "ELIGIBLE_FOR_BUYOUT",
  "SUBJECT_TO_ASSESSMENT",
  "EXEMPT",
]);

/** GET — Report D: Volunteer Requirement Compliance Report, real .xlsx download. */
export async function GET(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-reports:export", "reports");
    const { periodId } = await params;
    const url = new URL(request.url);
    const filters = parseVolunteerReportFilters(url, periodId);
    const complianceFilterParam = url.searchParams.get("complianceFilter");
    const complianceFilter =
      complianceFilterParam && COMPLIANCE_FILTERS.has(complianceFilterParam as ComplianceFilter) ? (complianceFilterParam as ComplianceFilter) : undefined;
    const generatedByName = await resolveGeneratedByName(session.userId);
    const data = await buildComplianceReportData(organizationId, { ...filters, complianceFilter }, generatedByName);
    const buffer = await buildVolunteerReportWorkbook(data, COMPLIANCE_COLUMNS);
    const filename = buildReportFilename(data.info.organizationName, data.info.reportTitle, data.info.requirementPeriodName);

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "pta.volunteer_hours.report_exported",
      entityType: "pta_volunteer_report",
      entityId: periodId,
      metadata: { reportType: "compliance", filters: url.search },
    });

    const responseBody = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(responseBody).set(buffer);
    return new Response(responseBody, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}
