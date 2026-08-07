import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/validation";
import { updateEvent, updateEventSchema } from "@/lib/event-mutations";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("events:read", "throw");
    const { id } = await params;

    const row = await prisma.event.findFirst({
      where: { id, organizationId },
      include: {
        _count: {
          select: {
            contributions: true,
          },
        },
      },
    });

    if (!row) {
      return Response.json({ ok: false, error: "Event not found" }, { status: 404 });
    }

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "read",
      entityType: "event",
      entityId: row.id,
    });

    return Response.json({ ok: true, data: row });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:events:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("events:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, updateEventSchema);

    const result = await updateEvent(organizationId, { userId: session.userId, userEmail: session.userEmail }, id, input);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data });
  });
}
