import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { createMember, createMemberSchema } from "@/lib/member-mutations";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("members:read", "throw");

    const rows = await prisma.orgMember.findMany({
      where: { organizationId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 200,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "member",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:members:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("members:write", "throw");
    const input = await parseJsonBody(request, createMemberSchema);

    const result = await createMember(organizationId, { userId: session.userId, userEmail: session.userEmail }, input);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data }, { status: 201 });
  });
}
