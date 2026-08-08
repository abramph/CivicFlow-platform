import { prisma } from "@/lib/prisma";
import { requirePlanFeature } from "@/lib/plan-gate";
import { buildReport, isReportType, validateReportDateRange, type ReportType } from "@/lib/reports/report-builder";
import { exportReport, reportContentType, reportFileName } from "@/lib/reports/exporters";
import { sendReportEmail } from "@/lib/reports/email-report";
import { z } from "@/lib/validation";

/**
 * Mobile Admin program (PR D) — "Email Me This Report." Reuses the exact
 * same buildReport()/exportReport()/sendReportEmail() the web
 * /api/reports/send route uses, but deliberately narrower: always sends to
 * the requesting officer's own verified mobile-session email (never an
 * arbitrary external address or a mass "all active members" send), and
 * never returns report bytes to the mobile client directly — the officer's
 * phone never holds the (up to 5000-row) dataset in memory, satisfying the
 * "no unbounded datasets on mobile" rule for free by routing through
 * existing, already-secure email delivery instead of an in-app file
 * viewer/download.
 *
 * The financial-report role gate below is copied verbatim from
 * src/app/api/reports/export/route.ts and .../send/route.ts (a hardcoded
 * role check layered on top of the reports:export RBAC permission) so
 * mobile can never bypass a restriction the web enforces.
 */

const FINANCIAL_REPORT_TYPES = new Set<ReportType>([
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
  "DELINQUENT_MEMBER_ROSTER",
]);
const FINANCIAL_ROLES = new Set(["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE"]);

export const sendMobileReportSchema = z.object({
  reportType: z.string(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  format: z.enum(["csv", "xlsx", "pdf"]).default("pdf"),
});
export type SendMobileReportInput = z.infer<typeof sendMobileReportSchema>;

export interface MobileReportActor {
  userId: string;
  email: string;
  role: string;
}

export type SendMobileReportResult = { ok: true; data: { sent: boolean } } | { ok: false; status: number; error: string };

export async function sendMobileReport(organizationId: string, actor: MobileReportActor, input: SendMobileReportInput): Promise<SendMobileReportResult> {
  if (!isReportType(input.reportType)) {
    return { ok: false, status: 400, error: "Invalid report type." };
  }

  const dateValidation = validateReportDateRange(input.startDate, input.endDate);
  if (dateValidation.error) return { ok: false, status: 400, error: dateValidation.error };

  if (FINANCIAL_REPORT_TYPES.has(input.reportType) && !FINANCIAL_ROLES.has(actor.role)) {
    return { ok: false, status: 403, error: "Financial report sends require a finance or administrator role." };
  }

  if (input.format === "pdf") {
    await requirePlanFeature(organizationId, "pdfExport");
  }

  const organization = await prisma.organization.findFirst({ where: { id: organizationId }, select: { name: true } });
  const report = await buildReport({
    organizationId,
    reportType: input.reportType,
    startDate: input.startDate,
    endDate: input.endDate,
  });
  const attachmentBuffer = await exportReport(report, input.format, organization?.name ?? "Unestra");

  await sendReportEmail({
    organizationId,
    reportType: input.reportType,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    format: input.format,
    recipientMode: "external",
    selectedMemberIds: [],
    externalEmail: actor.email,
    filters: {},
    report,
    subject: report.title,
    body: "Requested from the Unestra mobile app.",
    includeSummary: true,
    attachmentBuffer,
    attachmentFileName: reportFileName(input.reportType, input.format),
    attachmentContentType: reportContentType(input.format),
    actorUserId: actor.userId,
    actorEmail: actor.email,
  });

  return { ok: true, data: { sent: true } };
}
