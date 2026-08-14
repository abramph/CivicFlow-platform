import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { INDIVIDUAL_REPORTS, REPORT_TYPES, reportToCsv, runGivingReport, type ReportType } from "@/lib/giving/reports";
import { createAuditEvent } from "@/lib/audit";

/** CORE-GIVE-K (§52/§53) — giving reports. Aggregates need summary:view;
 * individual-naming types also need individual:view; CSV additionally
 * needs contributions:export and is ALWAYS audited. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, can } = await requirePermission("contributions:summary:view", "throw");
    const { searchParams } = new URL(request.url);

    const type = (searchParams.get("type") ?? "summary") as ReportType;
    if (!REPORT_TYPES.includes(type)) {
      return Response.json({ ok: false, error: "Unknown report type." }, { status: 400 });
    }
    if (INDIVIDUAL_REPORTS.includes(type) && !can("contributions:individual:view")) {
      return Response.json({ ok: false, error: "This report names individual contributors and needs additional permission." }, { status: 403 });
    }

    const now = new Date();
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const from = fromParam ? new Date(`${fromParam}T00:00:00.000Z`) : new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const to = toParam ? new Date(`${toParam}T00:00:00.000Z`) : new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      return Response.json({ ok: false, error: "Invalid date range." }, { status: 400 });
    }

    const report = await runGivingReport(organizationId, type, { from, to }, { fundId: searchParams.get("fundId") });

    if (searchParams.get("format") === "csv") {
      if (!can("contributions:export")) {
        return Response.json({ ok: false, error: "Exporting requires the contributions:export permission." }, { status: 403 });
      }
      await createAuditEvent({
        organizationId,
        actorUserId: session.userId,
        actorEmail: session.userEmail,
        action: "giving.report_exported",
        entityType: "giving_report",
        entityId: type,
        metadata: { type, from: from.toISOString(), to: to.toISOString(), rows: report.rows.length },
      });
      return new Response(reportToCsv(report), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="giving-${type}-${from.toISOString().slice(0, 10)}.csv"`,
        },
      });
    }
    return Response.json({ ok: true, data: report });
  });
}
