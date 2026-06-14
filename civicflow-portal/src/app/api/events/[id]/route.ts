import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const optionalTextField = (maxLength: number) =>
  z.union([z.string().trim().max(maxLength), z.literal(""), z.null()]).optional();

const optionalDateTimeField = z.union([z.string().datetime(), z.literal(""), z.null()]).optional();

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalDateTime(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (!value) return null;
  return new Date(value);
}

const updateEventSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: optionalTextField(4000),
  location: optionalTextField(240),
  startAt: optionalDateTimeField,
  endAt: optionalDateTimeField,
  status: z.string().trim().min(1).max(40).optional(),
  notes: optionalTextField(4000),
});

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

    const existing = await prisma.event.findFirst({ where: { id, organizationId } });
    if (!existing) {
      return Response.json({ ok: false, error: "Event not found" }, { status: 404 });
    }

    const startAt =
      input.startAt !== undefined ? normalizeOptionalDateTime(input.startAt) : existing.startAt;
    const endAt =
      input.endAt !== undefined ? normalizeOptionalDateTime(input.endAt) : existing.endAt;

    if (startAt && endAt && endAt < startAt) {
      throw new ValidationError("Event end time must be on or after the start time.");
    }

    const updated = await prisma.event.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: normalizeOptionalText(input.description) } : {}),
        ...(input.location !== undefined ? { location: normalizeOptionalText(input.location) } : {}),
        ...(input.startAt !== undefined ? { startAt: normalizeOptionalDateTime(input.startAt) } : {}),
        ...(input.endAt !== undefined ? { endAt: normalizeOptionalDateTime(input.endAt) } : {}),
        ...(input.status !== undefined ? { status: input.status.trim() } : {}),
        ...(input.notes !== undefined ? { notes: normalizeOptionalText(input.notes) } : {}),
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "update",
      entityType: "event",
      entityId: updated.id,
      metadata: {
        before: {
          title: existing.title,
          status: existing.status,
          location: existing.location,
        },
        after: {
          title: updated.title,
          status: updated.status,
          location: updated.location,
        },
      },
    });

    return Response.json({ ok: true, data: updated });
  });
}
