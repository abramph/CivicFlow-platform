import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { resolveMobileAdminCapabilities } from "@/lib/mobile-admin";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ organizationId: z.string().min(1) });

/** POST /api/mobile/admin/attendance-sessions/[sessionId]/close
 * Mirrors src/app/api/attendance-sessions/[id]/close/route.ts exactly. */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await parseJsonBody(request, bodySchema);
    const { userId, email } = await requireMobileAuth(request);
    const admin = await resolveMobileAdminCapabilities(organizationId, userId);
    if (!admin.available || !admin.adminCapabilities.includes("manageAttendance")) {
      throw new MobileForbiddenError("No mobile attendance administration access for this organization");
    }
    const { sessionId } = await params;

    const existing = await prisma.meetingAttendanceSession.findFirst({ where: { id: sessionId, organizationId } });
    if (!existing) return Response.json({ ok: false, error: "Attendance session not found" }, { status: 404 });

    const updated = await prisma.meetingAttendanceSession.update({
      where: { id: sessionId },
      data: { status: "CLOSED", closedByUserId: userId },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: userId,
      actorEmail: email,
      action: "close",
      entityType: "meeting_attendance_session",
      entityId: sessionId,
      metadata: { eventId: existing.eventId },
    });

    return Response.json({ ok: true, data: updated });
  });
}
