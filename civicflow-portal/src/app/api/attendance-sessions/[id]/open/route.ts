import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session: authSession, organizationId } = await requirePermission("attendance:write", "throw");
    const { id } = await params;

    const existing = await prisma.meetingAttendanceSession.findFirst({ where: { id, organizationId } });
    if (!existing) return Response.json({ ok: false, error: "Attendance session not found" }, { status: 404 });
    if (existing.status === "CANCELLED") {
      return Response.json({ ok: false, error: "This session was cancelled and can't be reopened this way." }, { status: 400 });
    }

    const updated = await prisma.meetingAttendanceSession.update({
      where: { id },
      data: { status: "OPEN", openedByUserId: authSession.userId },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: authSession.userId,
      actorEmail: authSession.userEmail,
      action: "open",
      entityType: "meeting_attendance_session",
      entityId: id,
      metadata: { meetingId: existing.meetingId, previousStatus: existing.status },
    });

    return Response.json({ ok: true, data: updated });
  });
}
