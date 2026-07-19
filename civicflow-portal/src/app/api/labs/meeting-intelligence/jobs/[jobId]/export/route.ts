import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { getLatestMeetingMinutesDraft } from "@/lib/labs/meeting-intelligence/minutes-review";
import { MeetingIntelligenceError } from "@/lib/labs/meeting-intelligence/errors";
import { exportMeetingMinutes, minutesExportContentType, minutesExportFileName } from "@/lib/labs/meeting-intelligence/export";
import { requirePlanFeature } from "@/lib/plan-gate";
import { createAuditEvent } from "@/lib/audit";
import type { StructuredMeetingMinutes } from "@/lib/labs/meeting-intelligence/minutes";

/**
 * Export is gated by two independent systems, deliberately not merged
 * into one check (see docs/meeting-intelligence.md's "Labs vs pdfExport
 * entitlement" section):
 *   1. requireMeetingIntelligenceAccess (Labs + tenant RBAC) — the primary
 *      gate for this entire internal-pilot feature.
 *   2. For format=pdf specifically, requirePlanFeature(..., "pdfExport")
 *      — the same plan-entitlement system already used for report/member
 *      PDF exports (docs/entitlements.md), applied here for consistency.
 *      APH Technologies is billing-exempt, which already resolves to the
 *      elite plan (pdfExport: true) — so this never actually blocks the
 *      pilot, but it keeps the two entitlement systems from silently
 *      diverging if Meeting Intelligence is ever extended to a
 *      non-billing-exempt organization. DOCX export is not subject to
 *      this second check, matching how CSV/XLSX report exports are never
 *      pdfExport-gated either — only the PDF format itself is.
 */
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireMeetingIntelligenceAccess("meetingIntelligence:read");
    const { jobId } = await params;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") === "docx" ? "docx" : "pdf";

    if (format === "pdf") {
      await requirePlanFeature(organizationId, "pdfExport");
    }

    const draft = await getLatestMeetingMinutesDraft(organizationId, jobId);
    if (!draft) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "No minutes draft found for this job.");

    const [job, organization] = await Promise.all([
      prisma.meetingIntelligenceJob.findFirstOrThrow({ where: { id: jobId, organizationId } }),
      prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
    ]);
    const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: job.meetingId } });

    let approvedByName: string | null = null;
    if (draft.status === "APPROVED" && draft.approvedByUserId) {
      const approver = await prisma.user.findUnique({ where: { id: draft.approvedByUserId }, select: { displayName: true, email: true } });
      approvedByName = approver?.displayName ?? approver?.email ?? null;
    }

    const buffer = await exportMeetingMinutes(
      {
        organizationName: organization.name,
        meetingTitle: meeting.title,
        meetingDate: meeting.meetingDate?.toISOString() ?? null,
        isApproved: draft.status === "APPROVED",
        approvedByName,
        approvedAt: draft.approvedAt?.toISOString() ?? null,
        content: draft.editableContentJson as unknown as StructuredMeetingMinutes,
      },
      format
    );

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "meeting_intelligence.export_generated",
      entityType: "meeting_minutes_draft",
      entityId: draft.id,
      metadata: { format, isApproved: draft.status === "APPROVED" },
    });

    const body = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(body).set(buffer);
    return new Response(body, {
      headers: {
        "Content-Type": minutesExportContentType(format),
        "Content-Disposition": `attachment; filename="${minutesExportFileName(meeting.title, format)}"`,
      },
    });
  });
}
