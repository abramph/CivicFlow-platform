import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const manualTimelineSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.union([z.string().trim().max(4000), z.literal(""), z.null()]).optional(),
  occurredAt: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("members:read", "throw");
    const { id } = await params;
    const rows = await prisma.memberTimelineEvent.findMany({
      where: { organizationId, memberId: id },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("members:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, manualTimelineSchema);
    const member = await prisma.orgMember.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!member) return Response.json({ ok: false, error: "Member not found" }, { status: 404 });
    const row = await createMemberTimelineEvent({
      organizationId,
      memberId: id,
      eventType: "MANUAL",
      title: input.title.trim(),
      description: input.description?.trim() || null,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      createdByUserId: session.userId,
    });
    await createAuditEvent({ organizationId, actorUserId: session.userId, actorEmail: session.userEmail, action: "create", entityType: "member_timeline_event", entityId: row.id, metadata: { memberId: id, title: row.title } });
    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}

