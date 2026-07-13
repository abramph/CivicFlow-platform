import { requireRole } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

/**
 * Reopening a closed session is more consequential than opening a fresh one
 * (it can affect a roster/report that's already been treated as final), so
 * this requires ORG_ADMIN or above rather than just attendance:write.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session: authSession, organizationId } = await requireRole("ORG_ADMIN", "throw");
    const { id } = await params;

    const existing = await prisma.meetingAttendanceSession.findFirst({ where: { id, organizationId } });
    if (!existing) return Response.json({ ok: false, error: "Attendance session not found" }, { status: 404 });
    if (existing.status !== "CLOSED") {
      return Response.json({ ok: false, error: "Only a closed session can be reopened." }, { status: 400 });
    }

    const updated = await prisma.meetingAttendanceSession.update({
      where: { id },
      data: { status: "OPEN", openedByUserId: authSession.userId },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: authSession.userId,
      actorEmail: authSession.userEmail,
      action: "reopen",
      entityType: "meeting_attendance_session",
      entityId: id,
      metadata: { meetingId: existing.meetingId },
    });

    return Response.json({ ok: true, data: updated });
  });
}
