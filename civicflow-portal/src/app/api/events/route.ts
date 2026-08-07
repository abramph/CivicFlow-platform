import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/validation";
import { createEvent, createEventSchema } from "@/lib/event-mutations";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("events:read", "throw");

    const rows = await prisma.event.findMany({
      where: { organizationId },
      orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
      take: 200,
      include: {
        _count: {
          select: {
            contributions: true,
          },
        },
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "event",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:events:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("events:write", "throw");
    const input = await parseJsonBody(request, createEventSchema);

    const row = await createEvent(organizationId, { userId: session.userId, userEmail: session.userEmail }, input);

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
