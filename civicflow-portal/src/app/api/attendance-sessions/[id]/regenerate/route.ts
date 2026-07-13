import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

/**
 * Bumps tokenVersion, instantly invalidating every QR code issued under the
 * previous version (see attendance-token.ts for why this needs no denylist).
 * Used both for "regenerate" (suspected sharing/leak) and as the mechanism
 * behind revoking a static code before its window would otherwise close.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session: authSession, organizationId } = await requirePermission("attendance:write", "throw");
    const { id } = await params;

    const existing = await prisma.meetingAttendanceSession.findFirst({ where: { id, organizationId } });
    if (!existing) return Response.json({ ok: false, error: "Attendance session not found" }, { status: 404 });

    const updated = await prisma.meetingAttendanceSession.update({
      where: { id },
      data: { tokenVersion: { increment: 1 } },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: authSession.userId,
      actorEmail: authSession.userEmail,
      action: "regenerate",
      entityType: "meeting_attendance_session",
      entityId: id,
      metadata: { meetingId: existing.meetingId, newTokenVersion: updated.tokenVersion },
    });

    return Response.json({ ok: true, data: updated });
  });
}
