import { createAuditEvent } from "@/lib/audit";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseVolunteerReportFilters, resolveGeneratedByName } from "@/lib/labs/pta/volunteer-hours/reports/shared";
import { buildVolunteerCategoryReportData, VOLUNTEER_CATEGORY_COLUMNS } from "@/lib/labs/pta/volunteer-hours/reports/volunteer-category";
import { buildReportFilename, buildVolunteerReportWorkbook } from "@/lib/labs/pta/volunteer-hours/reports/xlsx-builder";

/** GET — Report G: Volunteer Category Report, real .xlsx download. */
export async function GET(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-reports:export", "reports");
    const { periodId } = await params;
    const url = new URL(request.url);
    const filters = parseVolunteerReportFilters(url, periodId);
    const generatedByName = await resolveGeneratedByName(session.userId);
    const data = await buildVolunteerCategoryReportData(organizationId, filters, generatedByName);
    const buffer = await buildVolunteerReportWorkbook(data, VOLUNTEER_CATEGORY_COLUMNS);
    const filename = buildReportFilename(data.info.organizationName, data.info.reportTitle, data.info.requirementPeriodName);

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "pta.volunteer_hours.report_exported",
      entityType: "pta_volunteer_report",
      entityId: periodId,
      metadata: { reportType: "volunteer-category", filters: url.search },
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
