import { createAuditEvent } from "@/lib/audit";
import { withApiErrorHandling } from "@/lib/api-route";
import { PtaError } from "@/lib/labs/pta/errors";
import { requireVolunteerHoursHouseholdAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { getCurrentActivePeriod } from "@/lib/labs/pta/volunteer-hours/periods";
import { buildFamilySummaryReportData, FAMILY_SUMMARY_COLUMNS } from "@/lib/labs/pta/volunteer-hours/reports/family-summary";
import { buildReportFilename, buildVolunteerReportWorkbook } from "@/lib/labs/pta/volunteer-hours/reports/xlsx-builder";

// Same admin-column strip as the JSON route, applied to the xlsx column set.
const FAMILY_SELF_SERVICE_COLUMNS = FAMILY_SUMMARY_COLUMNS.filter((col) => col.header !== "Notes / exception");

/** GET — a family's own downloadable .xlsx volunteer-hour summary. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, adult } = await requireVolunteerHoursHouseholdAccess("reports");
    const url = new URL(request.url);
    let periodId = url.searchParams.get("periodId");
    if (!periodId) {
      const current = await getCurrentActivePeriod(organizationId);
      if (!current) return Response.json({ ok: false, error: "No active volunteer requirement period." }, { status: 404 });
      periodId = current.id;
    }

    const data = await buildFamilySummaryReportData(organizationId, { requirementPeriodId: periodId, householdId: adult.householdId }, adult.name).catch(
      (error) => {
        if (error instanceof PtaError && error.code === "PTA_VOLUNTEER_PERIOD_NOT_FOUND") return null;
        throw error;
      }
    );
    if (!data) return Response.json({ ok: false, error: "No active volunteer requirement period." }, { status: 404 });

    const buffer = await buildVolunteerReportWorkbook(data, FAMILY_SELF_SERVICE_COLUMNS);
    const filename = buildReportFilename(data.info.organizationName, "My Volunteer Hour Summary", data.info.requirementPeriodName);

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "pta.volunteer_hours.report_exported",
      entityType: "pta_volunteer_report",
      entityId: adult.householdId,
      metadata: { reportType: "my-household-summary", periodId },
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
