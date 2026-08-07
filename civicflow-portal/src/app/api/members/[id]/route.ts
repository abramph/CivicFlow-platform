import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { updateMember, updateMemberSchema } from "@/lib/member-mutations";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:members:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("members:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, updateMemberSchema);

    const result = await updateMember(organizationId, { userId: session.userId, userEmail: session.userEmail }, id, input);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data });
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:members:write",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("members:write", "throw");
    const { id } = await params;

    const existing = await prisma.orgMember.findFirst({ where: { id, organizationId } });
    if (!existing) {
      return Response.json({ ok: false, error: "Member not found" }, { status: 404 });
    }

    await prisma.orgMember.delete({ where: { id } });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "delete",
      entityType: "member",
      entityId: id,
      metadata: { deleted: { id, email: existing.email } },
    });

    return Response.json({ ok: true });
  });
}
