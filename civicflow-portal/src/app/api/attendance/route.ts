import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";
import { createMemberTimelineEvent } from "@/lib/member-timeline";

const optionalId = z.union([z.string().min(1), z.literal(""), z.null()]).optional();
const optionalText = (max: number) =>
  z.union([z.string().trim().max(max), z.literal(""), z.null()]).optional();
const optionalDate = z.union([z.string().datetime(), z.literal(""), z.null()]).optional();

const attendanceSchema = z.object({
  memberId: z.string().min(1),
  eventId: optionalId,
  meetingId: optionalId,
  meetingTitle: optionalText(255),
  meetingDate: z.string().datetime(),
  attendanceStatus: z.enum(["PRESENT", "ABSENT", "EXCUSED", "LATE", "VIRTUAL"]),
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

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("attendance:read", "throw");
    const rows = await prisma.attendanceRecord.findMany({
      where: { organizationId },
      orderBy: [{ meetingDate: "desc" }, { createdAt: "desc" }],
      include: { member: true, event: true },
      take: 200,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "attendance_record",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("attendance:write", "throw");
    const input = await parseJsonBody(request, attendanceSchema);
    const eventId = text(input.eventId);
    const meetingId = text(input.meetingId);

    const member = await prisma.orgMember.findFirst({
      where: { id: input.memberId, organizationId },
      select: { id: true },
    });
    if (!member) return Response.json({ ok: false, error: "Member not found in organization" }, { status: 404 });

    if (eventId) {
      const event = await prisma.event.findFirst({
        where: { id: eventId, organizationId },
        select: { id: true },
      });
      if (!event) return Response.json({ ok: false, error: "Event not found in organization" }, { status: 404 });
    }
    if (meetingId) {
      const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, organizationId }, select: { id: true, title: true } });
      if (!meeting) return Response.json({ ok: false, error: "Meeting not found in organization" }, { status: 404 });
    }

    if (!eventId && !meetingId && !text(input.meetingTitle)) {
      return Response.json({ ok: false, error: "Meeting title is required when no event or meeting is selected." }, { status: 400 });
    }

    const row = await prisma.attendanceRecord.create({
      data: {
        organizationId,
        memberId: input.memberId,
        eventId,
        meetingId,
        meetingTitle: text(input.meetingTitle),
        meetingDate: new Date(input.meetingDate),
        attendanceStatus: input.attendanceStatus,
        checkInTime: input.checkInTime ? new Date(input.checkInTime) : null,
        checkOutTime: input.checkOutTime ? new Date(input.checkOutTime) : null,
        notes: text(input.notes),
        recordedByUserId: session.userId,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "create",
      entityType: "attendance_record",
      entityId: row.id,
      metadata: {
        memberId: row.memberId,
        eventId: row.eventId,
        attendanceStatus: row.attendanceStatus,
      },
    });

    await createMemberTimelineEvent({
      organizationId,
      memberId: row.memberId,
      eventType: "ATTENDANCE_RECORDED",
      title: "Attendance recorded",
      description: row.meetingTitle,
      newValue: { attendanceRecordId: row.id, attendanceStatus: row.attendanceStatus, eventId: row.eventId, meetingId: row.meetingId },
      occurredAt: row.meetingDate,
      createdByUserId: session.userId,
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
