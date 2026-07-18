import { z } from "zod";
import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { requirePlanFeature } from "@/lib/plan-gate";
import { prisma } from "@/lib/prisma";
import { buildReport, isReportType, validateReportDateRange, type ReportType } from "@/lib/reports/report-builder";
import { exportReport, reportContentType, reportFileName } from "@/lib/reports/exporters";
import { sendReportEmail, type ReportRecipientMode } from "@/lib/reports/email-report";

const recipientModes = ["all_active", "filtered_members", "category", "location", "delinquent", "event_attendees", "meeting_attendees", "manual", "external"] as const;
const formats = ["csv", "xlsx", "pdf"] as const;
const financialReportTypes = new Set<ReportType>([
  "GENERAL_FINANCIAL",
  "CONTRIBUTIONS",
  "CAMPAIGNS",
  "EVENTS",
  "MONTHLY_DUES_COLLECTION",
  "OUTSTANDING_DUES",
  "FULL_YEAR_DUES_PAID",
  "DELINQUENT_MEMBERS",
  "EXPENDITURES",
  "PAYMENT_RECONCILIATION",
]);
const financialRoles = new Set(["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE"]);

const sendReportSchema = z.object({
  reportType: z.string(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  format: z.enum(formats).default("pdf"),
  deliveryAction: z.enum(["email_members", "email_selected", "email_external"]).default("email_members"),
  recipientMode: z.enum(recipientModes).default("all_active"),
  selectedMemberIds: z.array(z.string()).optional().default([]),
  externalEmail: z.string().email().optional().or(z.literal("")).nullable(),
  filters: z.record(z.string(), z.unknown()).optional().default({}),
  subject: z.string().min(1, "Subject is required."),
  body: z.string().min(1, "Message is required."),
  includeAttachment: z.boolean().default(true),
  includeSummary: z.boolean().default(true),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId, role } = await requirePermission("reports:export", "throw");
    await requirePermission("communications:write", "throw");
    const payload = sendReportSchema.safeParse(await request.json());
    if (!payload.success) {
      return Response.json({ error: payload.error.issues[0]?.message ?? "Invalid report send request." }, { status: 400 });
    }
    const input = payload.data;

    if (!isReportType(input.reportType)) {
      return Response.json({ error: "Invalid report type." }, { status: 400 });
    }
    const dateValidation = validateReportDateRange(input.startDate, input.endDate);
    if (dateValidation.error) return Response.json({ error: dateValidation.error }, { status: 400 });
    if (financialReportTypes.has(input.reportType) && !financialRoles.has(role)) {
      return Response.json({ error: "Financial report sends require a finance or administrator role." }, { status: 403 });
    }
    if (input.recipientMode === "external" && !input.externalEmail) {
      return Response.json({ error: "External recipient email is required." }, { status: 400 });
    }
    if (input.recipientMode === "manual" && input.selectedMemberIds.length === 0) {
      return Response.json({ error: "Select at least one member recipient." }, { status: 400 });
    }
    if (input.includeAttachment && input.format === "pdf") {
      await requirePlanFeature(organizationId, "pdfExport");
    }

    const organization = await prisma.organization.findFirst({
      where: { id: organizationId },
      select: { name: true },
    });
    const report = await buildReport({
      organizationId,
      reportType: input.reportType,
      startDate: input.startDate,
      endDate: input.endDate,
      filters: input.filters,
    });
    const attachmentBuffer = input.includeAttachment
      ? await exportReport(report, input.format, organization?.name ?? "Unestra")
      : null;

    const result = await sendReportEmail({
      organizationId,
      reportType: input.reportType,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      format: input.format,
      recipientMode: input.recipientMode as ReportRecipientMode,
      selectedMemberIds: input.selectedMemberIds,
      externalEmail: input.externalEmail ?? null,
      filters: input.filters,
      report,
      subject: input.subject,
      body: input.body,
      includeSummary: input.includeSummary,
      attachmentBuffer,
      attachmentFileName: input.includeAttachment ? reportFileName(input.reportType, input.format) : null,
      attachmentContentType: input.includeAttachment ? reportContentType(input.format) : null,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });

    return Response.json({ ok: true, ...result });
  });
}
