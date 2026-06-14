import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const attendanceStatus = z.enum(["PRESENT", "ABSENT", "EXCUSED", "LATE", "VIRTUAL"]);
const bulkAttendanceSchema = z.object({
  records: z.array(z.object({
    memberId: z.string().min(1),
    attendanceStatus,
    notes: z.union([z.string().trim().max(4000), z.literal(""), z.null()]).optional(),
  })),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("attendance:read", "throw");
    const { id } = await params;
    const rows = await prisma.attendanceRecord.findMany({
      where: { organizationId, meetingId: id },
      include: { member: true },
      orderBy: [{ member: { lastName: "asc" } }, { member: { firstName: "asc" } }],
    });
    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("attendance:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, bulkAttendanceSchema);

    const meeting = await prisma.meeting.findFirst({ where: { id, organizationId } });
    if (!meeting) return Response.json({ ok: false, error: "Meeting not found" }, { status: 404 });

    const memberIds = input.records.map((record) => record.memberId);
    const members = await prisma.orgMember.findMany({ where: { organizationId, id: { in: memberIds } }, select: { id: true } });
    if (members.length !== new Set(memberIds).size) {
      return Response.json({ ok: false, error: "One or more members were not found in organization." }, { status: 404 });
    }

    const rows = await prisma.$transaction(async (tx) => {
      const saved = [];
      for (const record of input.records) {
        const existing = await tx.attendanceRecord.findFirst({
          where: { organizationId, meetingId: id, memberId: record.memberId },
        });
        if (existing) {
          saved.push(await tx.attendanceRecord.update({
            where: { id: existing.id },
            data: {
              attendanceStatus: record.attendanceStatus,
              notes: record.notes?.trim() || null,
              recordedByUserId: session.userId,
            },
          }));
        } else {
          saved.push(await tx.attendanceRecord.create({
            data: {
              organizationId,
              meetingId: id,
              memberId: record.memberId,
              meetingTitle: meeting.title,
              meetingDate: meeting.meetingDate,
              attendanceStatus: record.attendanceStatus,
              notes: record.notes?.trim() || null,
              recordedByUserId: session.userId,
            },
          }));
        }
      }
      return saved;
    });

    await Promise.all(rows.map((row) =>
      createMemberTimelineEvent({
        organizationId,
        memberId: row.memberId,
        eventType: "ATTENDANCE_RECORDED",
        title: "Attendance recorded",
        description: meeting.title,
        newValue: { meetingId: id, attendanceStatus: row.attendanceStatus },
        createdByUserId: session.userId,
        occurredAt: row.meetingDate,
      })
    ));

    await createAuditEvent({ organizationId, actorUserId: session.userId, actorEmail: session.userEmail, action: "bulk_save", entityType: "meeting_attendance", entityId: id, metadata: { count: rows.length } });
    return Response.json({ ok: true, data: { count: rows.length } });
  });
}
