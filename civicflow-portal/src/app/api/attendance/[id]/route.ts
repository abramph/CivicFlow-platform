import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const optionalId = z.union([z.string().min(1), z.literal(""), z.null()]).optional();
const optionalText = (max: number) =>
  z.union([z.string().trim().max(max), z.literal(""), z.null()]).optional();
const optionalDate = z.union([z.string().datetime(), z.literal(""), z.null()]).optional();

const updateAttendanceSchema = z.object({
  memberId: z.string().min(1).optional(),
  eventId: optionalId,
  meetingId: optionalId,
  meetingTitle: optionalText(255),
  meetingDate: z.string().datetime().optional(),
  attendanceStatus: z.enum(["PRESENT", "ABSENT", "EXCUSED", "LATE", "VIRTUAL"]).optional(),
  checkInTime: optionalDate,
  checkOutTime: optionalDate,
  notes: optionalText(4000),
});

function text(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("attendance:read", "throw");
    const { id } = await params;
    const row = await prisma.attendanceRecord.findFirst({
      where: { id, organizationId },
      include: { member: true, event: true, recordedBy: true },
    });
    if (!row) return Response.json({ ok: false, error: "Attendance record not found" }, { status: 404 });
    return Response.json({ ok: true, data: row });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("attendance:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, updateAttendanceSchema);

    const existing = await prisma.attendanceRecord.findFirst({ where: { id, organizationId } });
    if (!existing) return Response.json({ ok: false, error: "Attendance record not found" }, { status: 404 });

    if (input.memberId && !(await prisma.orgMember.findFirst({ where: { id: input.memberId, organizationId }, select: { id: true } }))) {
      return Response.json({ ok: false, error: "Member not found in organization" }, { status: 404 });
    }
    const eventId = text(input.eventId);
    if (eventId && !(await prisma.event.findFirst({ where: { id: eventId, organizationId }, select: { id: true } }))) {
      return Response.json({ ok: false, error: "Event not found in organization" }, { status: 404 });
    }
    const meetingId = text(input.meetingId);
    if (meetingId && !(await prisma.meeting.findFirst({ where: { id: meetingId, organizationId }, select: { id: true } }))) {
      return Response.json({ ok: false, error: "Meeting not found in organization" }, { status: 404 });
    }

    const updated = await prisma.attendanceRecord.update({
      where: { id },
      data: {
        ...(input.memberId !== undefined ? { memberId: input.memberId } : {}),
        ...(input.eventId !== undefined ? { eventId } : {}),
        ...(input.meetingId !== undefined ? { meetingId } : {}),
        ...(input.meetingTitle !== undefined ? { meetingTitle: text(input.meetingTitle) } : {}),
        ...(input.meetingDate !== undefined ? { meetingDate: new Date(input.meetingDate) } : {}),
        ...(input.attendanceStatus !== undefined ? { attendanceStatus: input.attendanceStatus } : {}),
        ...(input.checkInTime !== undefined ? { checkInTime: input.checkInTime ? new Date(input.checkInTime) : null } : {}),
        ...(input.checkOutTime !== undefined ? { checkOutTime: input.checkOutTime ? new Date(input.checkOutTime) : null } : {}),
        ...(input.notes !== undefined ? { notes: text(input.notes) } : {}),
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "update",
      entityType: "attendance_record",
      entityId: updated.id,
      metadata: { before: existing, after: updated },
    });

    return Response.json({ ok: true, data: updated });
  });
}
