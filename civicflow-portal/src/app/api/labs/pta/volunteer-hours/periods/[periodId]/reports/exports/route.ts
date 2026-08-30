import type { Prisma } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { permissionForVolunteerReportType, VOLUNTEER_REPORT_TYPES } from "@/lib/labs/pta/volunteer-hours/reports/dispatch";
import { volunteerReportFiltersToJson } from "@/lib/labs/pta/volunteer-hours/reports/shared";
import { PERMISSIONS } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const queueBodySchema = z.object({
  reportType: z.enum(VOLUNTEER_REPORT_TYPES),
  dateRangeStart: z.string().datetime().optional(),
  dateRangeEnd: z.string().datetime().optional(),
  householdId: z.string().min(1).optional(),
  householdAdultId: z.string().min(1).optional(),
  gradeId: z.string().min(1).optional(),
  classroomId: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
  volunteerCategory: z.string().min(1).optional(),
  approvalStatus: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  requirementStatus: z.string().min(1).optional(),
  paymentStatus: z.string().min(1).optional(),
  complianceFilter: z.string().min(1).optional(),
});

/**
 * POST — queues a background Report A-G export (spec: "background
 * generation for large orgs"), reusing the platform's existing
 * `ReportExport` model/worker (`processQueuedReportExport(s)` in
 * src/lib/reports.ts) rather than a second job-queue mechanism. Permission
 * is resolved per reportType — Report E requires the stricter financial
 * permission, everything else the general reports:export permission — so a
 * STAFF officer can queue Reports A-D/F/G but not E.
 */
export async function POST(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { periodId } = await params;
    const input = await parseJsonBody(request, queueBodySchema);
    const permission = input.reportType === "PTA_VOLUNTEER_FINANCIAL" ? PERMISSIONS.PTA_VOLUNTEER_FINANCIAL_REPORTS_VIEW : PERMISSIONS.PTA_VOLUNTEER_REPORTS_EXPORT;
    const { organizationId, session, can } = await requireVolunteerHoursAccess(permission, "reports");
    // Deployment-gate review: a caller's financial-report permission at the
    // MOMENT OF ENQUEUE is snapshotted into filters (no schema migration --
    // reuses the existing Json column; volunteerReportFiltersFromJson
    // ignores unknown keys, so this is additive and invisible to every other
    // reader of this field). processQueuedReportExport (reports.ts) requires
    // BOTH this snapshot AND a fresh recheck at processing time before
    // including financial content -- a permission GAINED after enqueue can
    // never expand what an already-queued export contains, only a LOSS can
    // narrow it further. Meaningful for PTA_VOLUNTEER_FAMILY_SUMMARY and
    // PTA_VOLUNTEER_COMPLIANCE (the two report types whose financial content
    // is gated by a permission finer than the report TYPE itself); harmless
    // no-op for every other type.
    const includeFinancialsAtEnqueue = can(PERMISSIONS.PTA_VOLUNTEER_FINANCIAL_REPORTS_VIEW);

    const filters = volunteerReportFiltersToJson({
      requirementPeriodId: periodId,
      dateRangeStart: input.dateRangeStart ? new Date(input.dateRangeStart) : undefined,
      dateRangeEnd: input.dateRangeEnd ? new Date(input.dateRangeEnd) : undefined,
      householdId: input.householdId,
      householdAdultId: input.householdAdultId,
      gradeId: input.gradeId,
      classroomId: input.classroomId,
      eventId: input.eventId,
      volunteerCategory: input.volunteerCategory,
      approvalStatus: input.approvalStatus,
      requirementStatus: input.requirementStatus,
      paymentStatus: input.paymentStatus,
      complianceFilter: input.complianceFilter,
    });

    const row = await prisma.reportExport.create({
      data: {
        organizationId,
        reportType: input.reportType,
        outputFormat: "xlsx",
        filters: { ...filters, _includeFinancialsAtEnqueue: includeFinancialsAtEnqueue } as Prisma.InputJsonValue,
        status: "QUEUED",
        createdByUserId: session.userId,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "pta.volunteer_hours.report_export_queued",
      entityType: "pta_volunteer_report_export",
      entityId: row.id,
      metadata: { reportType: row.reportType, filters },
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}

/** GET — lists this org's queued/completed/failed volunteer-report exports,
 * scoped to whichever report types the caller is allowed to view (a STAFF
 * officer never sees a FINANCE-only Report E export row, even in a list). */
export async function GET(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, can } = await requireVolunteerHoursAccess("pta:volunteer-reports:view", "reports");
    const { periodId } = await params;
    const visibleTypes = VOLUNTEER_REPORT_TYPES.filter((type) => can(permissionForVolunteerReportType(type)));

    const exports = await prisma.reportExport.findMany({
      where: { organizationId, reportType: { in: visibleTypes } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const filtered = exports.filter((e) => {
      const filters = e.filters as { requirementPeriodId?: string } | null;
      return filters?.requirementPeriodId === periodId;
    });

    return Response.json({ ok: true, data: filtered });
  });
}
