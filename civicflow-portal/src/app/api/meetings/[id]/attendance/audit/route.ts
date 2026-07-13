import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";

/**
 * Audit trail for a meeting's attendance: every session lifecycle event
 * (create/open/close/reopen/regenerate) plus every attendance_record write
 * (check_in/create/update/export) whose entityId is either the meeting
 * itself, one of its sessions, or one of its attendance records.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("attendance:read", "throw");
    const { id } = await params;

    const [sessions, records] = await Promise.all([
      prisma.meetingAttendanceSession.findMany({ where: { organizationId, meetingId: id }, select: { id: true } }),
      prisma.attendanceRecord.findMany({ where: { organizationId, meetingId: id }, select: { id: true } }),
    ]);
    const resourceIds = [id, ...sessions.map((s) => s.id), ...records.map((r) => r.id)];

    const events = await prisma.auditEvent.findMany({
      where: {
        organizationId,
        resource: { in: ["meeting", "meeting_attendance_session", "attendance_record", "meeting_attendance"] },
        resourceId: { in: resourceIds },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return Response.json({ ok: true, data: events });
  });
}
