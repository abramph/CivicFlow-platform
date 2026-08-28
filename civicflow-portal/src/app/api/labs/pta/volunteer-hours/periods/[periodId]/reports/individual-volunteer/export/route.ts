import { createAuditEvent } from "@/lib/audit";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { buildIndividualVolunteerReportData, INDIVIDUAL_VOLUNTEER_COLUMNS } from "@/lib/labs/pta/volunteer-hours/reports/individual-volunteer";
import { parseVolunteerReportFilters, resolveGeneratedByName } from "@/lib/labs/pta/volunteer-hours/reports/shared";
import { buildReportFilename, buildVolunteerReportWorkbook } from "@/lib/labs/pta/volunteer-hours/reports/xlsx-builder";

/** GET — Report F: Individual Volunteer Report, real .xlsx download. */
export async function GET(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-reports:export", "reports");
    const { periodId } = await params;
    const url = new URL(request.url);
    const filters = parseVolunteerReportFilters(url, periodId);
    const generatedByName = await resolveGeneratedByName(session.userId);
    const data = await buildIndividualVolunteerReportData(organizationId, filters, generatedByName);
    const buffer = await buildVolunteerReportWorkbook(data, INDIVIDUAL_VOLUNTEER_COLUMNS);
    const filename = buildReportFilename(data.info.organizationName, data.info.reportTitle, data.info.requirementPeriodName);

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "pta.volunteer_hours.report_exported",
      entityType: "pta_volunteer_report",
      entityId: periodId,
      metadata: { reportType: "individual-volunteer", filters: url.search },
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
