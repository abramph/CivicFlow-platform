import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { EVENT_STATUSES } from "@/lib/event-status";
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

const createEventSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: optionalTextField(4000),
  location: optionalTextField(240),
  startAt: optionalDateTimeField,
  endAt: optionalDateTimeField,
  status: z.enum(EVENT_STATUSES),
  notes: optionalTextField(4000),
});

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

    const startAt = normalizeOptionalDateTime(input.startAt);
    const endAt = normalizeOptionalDateTime(input.endAt);

    if (startAt && endAt && endAt < startAt) {
      throw new ValidationError("Event end time must be on or after the start time.");
    }

    const row = await prisma.event.create({
      data: {
        organizationId,
        title: input.title.trim(),
        description: normalizeOptionalText(input.description) ?? null,
        location: normalizeOptionalText(input.location) ?? null,
        startAt: startAt ?? null,
        endAt: endAt ?? null,
        status: input.status.trim(),
        notes: normalizeOptionalText(input.notes) ?? null,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "create",
      entityType: "event",
      entityId: row.id,
      metadata: {
        title: row.title,
        status: row.status,
        location: row.location,
      },
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
