import { NextResponse } from "next/server";
import { createAuditEvent } from "@/lib/audit";
import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { requirePlanFeature } from "@/lib/plan-gate";
import { prisma } from "@/lib/prisma";
import { buildReport, isReportType, validateReportDateRange, type ReportType } from "@/lib/reports/report-builder";
import { exportReport, reportContentType, reportFileName, type ReportExportFormat } from "@/lib/reports/exporters";

const exportFormats = new Set(["csv", "xlsx", "pdf"]);
const financialReportTypes = new Set<ReportType>([
  "GENERAL_FINANCIAL",
  "CONTRIBUTIONS",
  "CAMPAIGNS",
  "EVENTS",
  "MONTHLY_DUES_COLLECTION",
  "DUES_PAYMENT_DETAIL",
  "OUTSTANDING_DUES",
  "DUES_CURRENT_MEMBERS",
  "FULL_YEAR_DUES_PAID",
  "DELINQUENT_MEMBERS",
  "CAMPAIGN_PAYERS",
  "EXPENDITURES",
  "PAYMENT_RECONCILIATION",
  // Shows Outstanding Dues per member, same as DELINQUENT_MEMBERS above.
  "DELINQUENT_MEMBER_ROSTER",
]);
const financialRoles = new Set(["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE"]);

function parseFilters(params: URLSearchParams) {
  const filters: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (!["reportType", "startDate", "endDate", "format"].includes(key)) filters[key] = value;
  }
  return filters;
}

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId, role } = await requirePermission("reports:export", "throw");
    const { searchParams } = new URL(request.url);
    const reportTypeParam = searchParams.get("reportType");
    const formatParam = searchParams.get("format") ?? "csv";
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (!isReportType(reportTypeParam)) {
      return NextResponse.json({ error: "Invalid report type." }, { status: 400 });
    }
    if (!exportFormats.has(formatParam)) {
      return NextResponse.json({ error: "Invalid export format." }, { status: 400 });
    }
    const dateValidation = validateReportDateRange(startDate, endDate);
    if (dateValidation.error) return NextResponse.json({ error: dateValidation.error }, { status: 400 });
    if (financialReportTypes.has(reportTypeParam) && !financialRoles.has(role)) {
      return NextResponse.json({ error: "Financial report export requires a finance or administrator role." }, { status: 403 });
    }
    if (formatParam === "pdf") {
      await requirePlanFeature(organizationId, "pdfExport");
    }

    const organization = await prisma.organization.findFirst({
      where: { id: organizationId },
      select: { name: true },
    });
    const report = await buildReport({
      organizationId,
      reportType: reportTypeParam,
      startDate,
      endDate,
      filters: parseFilters(searchParams),
    });
    const format = formatParam as ReportExportFormat;
    const body = await exportReport(report, format, organization?.name ?? "Unestra");

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "export",
      entityType: "report",
      entityId: reportTypeParam,
      metadata: {
        reportType: reportTypeParam,
        format,
        startDate,
        endDate,
        filters: parseFilters(searchParams),
      },
    });

    const responseBody = new ArrayBuffer(body.byteLength);
    new Uint8Array(responseBody).set(body);
    // PDFs open inline (browser's native viewer, with its own save/print
    // controls) so the user can look the report over before deciding to keep
    // it — the web equivalent of the desktop app's PDF preview window. CSV/
    // XLSX have no native browser viewer, so those still download directly.
    const disposition = format === "pdf" ? "inline" : "attachment";
    return new Response(responseBody, {
      headers: {
        "Content-Type": reportContentType(format),
        "Content-Disposition": `${disposition}; filename="${reportFileName(reportTypeParam, format)}"`,
      },
    });
  });
}
