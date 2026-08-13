import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const optionalText = (max: number) => z.union([z.string().trim().max(max), z.literal(""), z.null()]).optional();
const updateMeetingSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  meetingType: optionalText(120),
  meetingDate: z.string().datetime().optional(),
  location: optionalText(255),
  description: optionalText(4000),
  notes: optionalText(4000),
  // PTA-C additions — display-only URL for hybrid meetings and an
  // informational quorum threshold (never a hard block).
  virtualMeetingUrl: optionalText(500),
  quorumRequired: z.number().int().min(1).max(100000).nullable().optional(),
});

function text(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("meetings:read", "throw");
    const { id } = await params;
    const row = await prisma.meeting.findFirst({ where: { id, organizationId }, include: { attendanceRecords: true } });
    if (!row) return Response.json({ ok: false, error: "Meeting not found" }, { status: 404 });
    return Response.json({ ok: true, data: row });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("meetings:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, updateMeetingSchema);
    const existing = await prisma.meeting.findFirst({ where: { id, organizationId } });
    if (!existing) return Response.json({ ok: false, error: "Meeting not found" }, { status: 404 });
    const updated = await prisma.meeting.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.meetingType !== undefined ? { meetingType: text(input.meetingType) } : {}),
        ...(input.meetingDate !== undefined ? { meetingDate: new Date(input.meetingDate) } : {}),
        ...(input.location !== undefined ? { location: text(input.location) } : {}),
        ...(input.description !== undefined ? { description: text(input.description) } : {}),
        ...(input.notes !== undefined ? { notes: text(input.notes) } : {}),
        ...(input.virtualMeetingUrl !== undefined ? { virtualMeetingUrl: text(input.virtualMeetingUrl) } : {}),
        ...(input.quorumRequired !== undefined ? { quorumRequired: input.quorumRequired } : {}),
      },
    });
    await createAuditEvent({ organizationId, actorUserId: session.userId, actorEmail: session.userEmail, action: "update", entityType: "meeting", entityId: updated.id, metadata: { before: existing, after: updated } });
    return Response.json({ ok: true, data: updated });
  });
}

