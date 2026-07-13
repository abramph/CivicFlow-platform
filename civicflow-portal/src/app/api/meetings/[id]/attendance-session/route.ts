import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const createSchema = z.object({
  mode: z.enum(["ROTATING_QR", "STATIC_QR"]).default("ROTATING_QR"),
  opensAt: z.union([z.string().datetime(), z.null()]).optional(),
  closesAt: z.union([z.string().datetime(), z.null()]).optional(),
  lateThresholdMinutes: z.number().int().min(0).max(180).optional(),
  rotationSeconds: z.number().int().min(5).max(300).optional(),
});

/** The meeting's most recent attendance session (any status), for the
 * Attendance tab to render its current state on load. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("attendance:read", "throw");
    const { id } = await params;
    const session = await prisma.meetingAttendanceSession.findFirst({
      where: { organizationId, meetingId: id },
      orderBy: { createdAt: "desc" },
    });
    return Response.json({ ok: true, data: session });
  });
}

/**
 * Creates a new attendance session for a meeting (DRAFT). If one already
 * exists in DRAFT or OPEN status, returns it as-is rather than creating a
 * second concurrent session for the same meeting.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session: authSession, organizationId } = await requirePermission("attendance:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, createSchema);

    const meeting = await prisma.meeting.findFirst({ where: { id, organizationId } });
    if (!meeting) return Response.json({ ok: false, error: "Meeting not found" }, { status: 404 });

    const existing = await prisma.meetingAttendanceSession.findFirst({
      where: { organizationId, meetingId: id, status: { in: ["DRAFT", "OPEN"] } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return Response.json({ ok: true, data: existing });

    const created = await prisma.meetingAttendanceSession.create({
      data: {
        organizationId,
        meetingId: id,
        mode: input.mode,
        opensAt: input.opensAt ? new Date(input.opensAt) : null,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
        lateThresholdMinutes: input.lateThresholdMinutes ?? 10,
        rotationSeconds: input.rotationSeconds ?? 30,
        createdByUserId: authSession.userId,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: authSession.userId,
      actorEmail: authSession.userEmail,
      action: "create",
      entityType: "meeting_attendance_session",
      entityId: created.id,
      metadata: { meetingId: id, mode: created.mode },
    });

    return Response.json({ ok: true, data: created }, { status: 201 });
  });
}
