import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { requireRateLimit } from "@/lib/rate-limit";

const createReportExportSchema = z.object({
  reportType: z.string().min(1).max(120),
  outputFormat: z.enum(["preview", "csv", "xlsx", "pdf", "print"]).optional(),
  startDate: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
  endDate: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
  memberId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  categoryId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  campaignId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  eventId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  meetingId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  status: z.union([z.string().max(120), z.literal(""), z.null()]).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});

function parseRange(startDate?: string | null, endDate?: string | null) {
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  if (start && end && start > end) throw new ValidationError("Start date must be before end date.");
  return { start, end };
}

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("reports:read", "throw");
    const url = new URL(request.url);
    const reportType = url.searchParams.get("reportType");

    if (reportType) {
      const { start, end } = parseRange(url.searchParams.get("startDate"), url.searchParams.get("endDate"));
      const dateFilter = start || end ? { gte: start ?? undefined, lte: end ?? undefined } : undefined;
      const take = 100;
      let rows: unknown[] = [];

      if (reportType === "members") {
        rows = await prisma.orgMember.findMany({ where: { organizationId }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take });
      } else if (reportType === "expenditures") {
        rows = await prisma.expenditure.findMany({ where: { organizationId, ...(dateFilter ? { date: dateFilter } : {}) }, orderBy: { date: "desc" }, take });
      } else if (reportType === "communications" || reportType === "follow-ups") {
        rows = await prisma.communicationLog.findMany({ where: { organizationId, ...(reportType === "follow-ups" ? { followUpRequired: true } : {}), ...(dateFilter ? { communicationDate: dateFilter } : {}) }, orderBy: { communicationDate: "desc" }, take });
      } else if (reportType === "communication-campaigns") {
        rows = await prisma.communicationCampaign.findMany({ where: { organizationId, ...(dateFilter ? { createdAt: dateFilter } : {}) }, orderBy: { createdAt: "desc" }, take });
      } else if (reportType === "communication-delivery" || reportType === "failed-communications") {
        rows = await prisma.communicationRecipient.findMany({ where: { organizationId, ...(reportType === "failed-communications" ? { deliveryStatus: "FAILED" } : {}), ...(dateFilter ? { createdAt: dateFilter } : {}) }, orderBy: { createdAt: "desc" }, take });
      } else if (reportType === "electronic-payment-imports") {
        rows = await prisma.paymentImportBatch.findMany({ where: { organizationId, ...(dateFilter ? { uploadedAt: dateFilter } : {}) }, orderBy: { uploadedAt: "desc" }, take });
      } else if (reportType === "reconciliation-pending" || reportType === "posted-electronic-payments") {
        rows = await prisma.paymentImportItem.findMany({ where: { organizationId, ...(reportType === "reconciliation-pending" ? { verificationStatus: "PENDING_REVIEW" } : { verificationStatus: "POSTED" }), ...(dateFilter ? { transactionDate: dateFilter } : {}) }, orderBy: { transactionDate: "desc" }, take });
      } else if (reportType === "attendance" || reportType === "meeting-attendance" || reportType === "event-attendance") {
        rows = await prisma.attendanceRecord.findMany({ where: { organizationId, ...(dateFilter ? { meetingDate: dateFilter } : {}) }, orderBy: { meetingDate: "desc" }, take });
      } else if (reportType === "member-transitions" || reportType === "status-transitions") {
        rows = await prisma.memberTimelineEvent.findMany({ where: { organizationId, ...(dateFilter ? { occurredAt: dateFilter } : {}) }, orderBy: { occurredAt: "desc" }, take });
      } else if (reportType === "delinquent-members") {
        rows = await prisma.orgMember.findMany({ where: { organizationId, isDelinquent: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take });
      } else if (reportType === "inactive-members") {
        rows = await prisma.orgMember.findMany({ where: { organizationId, membershipStatus: { in: ["inactive", "deactivated", "terminated"] } }, orderBy: [{ updatedAt: "desc" }], take });
      } else if (reportType === "dues-aging") {
        rows = await prisma.duesCharge.findMany({ where: { organizationId, status: { in: ["PENDING", "PARTIAL"] }, ...(dateFilter ? { dueDate: dateFilter } : {}) }, orderBy: { dueDate: "asc" }, take });
      } else if (reportType === "dues-adjustments") {
        rows = await prisma.duesAdjustment.findMany({ where: { organizationId, ...(dateFilter ? { createdAt: dateFilter } : {}) }, orderBy: { createdAt: "desc" }, take });
      } else if (reportType === "financial-edits") {
        rows = await prisma.auditEvent.findMany({ where: { organizationId, resource: { in: ["expenditure", "dues_charge", "dues_payment", "contribution", "contribution_receipt"] }, action: { in: ["update", "void", "correction"] }, ...(dateFilter ? { createdAt: dateFilter } : {}) }, orderBy: { createdAt: "desc" }, take });
      } else if (reportType === "voided-corrected-transactions") {
        rows = await prisma.expenditure.findMany({ where: { organizationId, OR: [{ voidedAt: { not: null } }, { correctionOfId: { not: null } }, { correctedById: { not: null } }] }, orderBy: { updatedAt: "desc" }, take });
      } else if (reportType.includes("contribution")) {
        rows = await prisma.contribution.findMany({ where: { organizationId, ...(dateFilter ? { contributionDate: dateFilter } : {}) }, orderBy: { contributionDate: "desc" }, take });
      } else if (reportType.includes("dues-payment")) {
        rows = await prisma.duesPayment.findMany({ where: { organizationId, ...(dateFilter ? { paymentDate: dateFilter } : {}) }, orderBy: { paymentDate: "desc" }, take });
      } else if (reportType.includes("dues")) {
        rows = await prisma.duesCharge.findMany({ where: { organizationId, ...(dateFilter ? { dueDate: dateFilter } : {}) }, orderBy: { dueDate: "desc" }, take });
      } else if (reportType.includes("campaign")) {
        rows = await prisma.campaign.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take });
      } else if (reportType.includes("event")) {
        rows = await prisma.event.findMany({ where: { organizationId, ...(dateFilter ? { startAt: dateFilter } : {}) }, orderBy: { startAt: "desc" }, take });
      }

      await createAuditEvent({ organizationId, actorUserId: session.userId, actorEmail: session.userEmail, action: "list", entityType: "report_preview", metadata: { reportType, count: rows.length } });
      return Response.json({ ok: true, data: { reportType, rows } });
    }

    const rows = await prisma.reportExport.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "report_export",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:reports:export",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("reports:export", "throw");
    const input = await parseJsonBody(request, createReportExportSchema);
    const { start, end } = parseRange(input.startDate, input.endDate);
    const filters = {
      ...(input.filters ?? {}),
      startDate: start?.toISOString() ?? null,
      endDate: end?.toISOString() ?? null,
      memberId: input.memberId || null,
      categoryId: input.categoryId || null,
      campaignId: input.campaignId || null,
      eventId: input.eventId || null,
      meetingId: input.meetingId || null,
      status: input.status || null,
    };

    const row = await prisma.reportExport.create({
      data: {
        organizationId,
        reportType: input.reportType,
        outputFormat: input.outputFormat === "preview" ? "csv" : input.outputFormat ?? "csv",
        filters: filters as Prisma.InputJsonValue,
        status: "QUEUED",
        createdByUserId: session.userId,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "export",
      entityType: "report_export",
      entityId: row.id,
      metadata: {
        reportType: row.reportType,
        outputFormat: row.outputFormat,
        status: row.status,
        filters,
      },
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
