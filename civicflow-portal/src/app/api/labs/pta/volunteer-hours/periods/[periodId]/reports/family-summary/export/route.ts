import { PERMISSIONS } from "@/lib/rbac";
import { createAuditEvent } from "@/lib/audit";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { buildFamilySummaryReportData, getFamilySummaryColumns } from "@/lib/labs/pta/volunteer-hours/reports/family-summary";
import { parseVolunteerReportFilters, resolveGeneratedByName } from "@/lib/labs/pta/volunteer-hours/reports/shared";
import { buildReportFilename, buildVolunteerReportWorkbook } from "@/lib/labs/pta/volunteer-hours/reports/xlsx-builder";

/** GET — Report A: Family Volunteer Summary, real .xlsx download. Calls the
 * exact same build*Data function the JSON route uses (spec §14) — the
 * on-screen totals and the downloaded workbook can never diverge, including
 * whether the financial columns are present (fix/pta-volunteer-financial-controls). */
export async function GET(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, can } = await requireVolunteerHoursAccess("pta:volunteer-reports:export", "reports");
    const { periodId } = await params;
    const url = new URL(request.url);
    const filters = parseVolunteerReportFilters(url, periodId);
    const generatedByName = await resolveGeneratedByName(session.userId);
    const includeFinancials = can(PERMISSIONS.PTA_VOLUNTEER_FINANCIAL_REPORTS_VIEW);
    const data = await buildFamilySummaryReportData(organizationId, filters, generatedByName, includeFinancials);
    const buffer = await buildVolunteerReportWorkbook(data, getFamilySummaryColumns(includeFinancials));
    const filename = buildReportFilename(data.info.organizationName, data.info.reportTitle, data.info.requirementPeriodName);

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "pta.volunteer_hours.report_exported",
      entityType: "pta_volunteer_report",
      entityId: periodId,
      metadata: { reportType: "family-summary", filters: url.search },
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
