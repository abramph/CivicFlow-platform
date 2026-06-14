import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const optionalText = (max: number) => z.union([z.string().trim().max(max), z.literal(""), z.null()]).optional();
const meetingSchema = z.object({
  title: z.string().trim().min(1).max(255),
  meetingType: optionalText(120),
  meetingDate: z.string().datetime(),
  location: optionalText(255),
  description: optionalText(4000),
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
    const { organizationId } = await requirePermission("meetings:read", "throw");
    const rows = await prisma.meeting.findMany({
      where: { organizationId },
      orderBy: [{ meetingDate: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { attendanceRecords: true } } },
      take: 200,
    });
    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("meetings:write", "throw");
    const input = await parseJsonBody(request, meetingSchema);
    const row = await prisma.meeting.create({
      data: {
        organizationId,
        title: input.title.trim(),
        meetingType: text(input.meetingType),
        meetingDate: new Date(input.meetingDate),
        location: text(input.location),
        description: text(input.description),
        notes: text(input.notes),
        createdByUserId: session.userId,
      },
    });
    await createAuditEvent({ organizationId, actorUserId: session.userId, actorEmail: session.userEmail, action: "create", entityType: "meeting", entityId: row.id, metadata: { title: row.title, meetingDate: row.meetingDate.toISOString() } });
    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}

