import type { Event } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { EVENT_STATUSES } from "@/lib/event-status";
import { z, ValidationError } from "@/lib/validation";

/**
 * Shared Event create/update business logic — used by both the web portal
 * routes (src/app/api/events/route.ts, [id]/route.ts) and the mobile admin
 * routes (src/app/api/mobile/admin/events/*). Extracted so neither surface
 * can drift from the other's validation or audit behavior.
 */

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

export const createEventSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: optionalTextField(4000),
  location: optionalTextField(240),
  startAt: optionalDateTimeField,
  endAt: optionalDateTimeField,
  status: z.enum(EVENT_STATUSES),
  notes: optionalTextField(4000),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: optionalTextField(4000),
  location: optionalTextField(240),
  startAt: optionalDateTimeField,
  endAt: optionalDateTimeField,
  status: z.enum(EVENT_STATUSES).optional(),
  notes: optionalTextField(4000),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export interface EventMutationActor {
  userId: string;
  userEmail?: string | null;
}

export async function createEvent(
  organizationId: string,
  actor: EventMutationActor,
  input: CreateEventInput
): Promise<Event> {
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
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "create",
    entityType: "event",
    entityId: row.id,
    metadata: { title: row.title, status: row.status, location: row.location },
  });

  return row;
}

export type UpdateEventResult = { ok: true; data: Event } | { ok: false; status: number; error: string };

export async function updateEvent(
  organizationId: string,
  actor: EventMutationActor,
  eventId: string,
  input: UpdateEventInput
): Promise<UpdateEventResult> {
  const existing = await prisma.event.findFirst({ where: { id: eventId, organizationId } });
  if (!existing) {
    return { ok: false, status: 404, error: "Event not found" };
  }

  const startAt = input.startAt !== undefined ? normalizeOptionalDateTime(input.startAt) : existing.startAt;
  const endAt = input.endAt !== undefined ? normalizeOptionalDateTime(input.endAt) : existing.endAt;

  if (startAt && endAt && endAt < startAt) {
    throw new ValidationError("Event end time must be on or after the start time.");
  }

  const updated = await prisma.event.update({
    where: { id: eventId },
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
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "update",
    entityType: "event",
    entityId: updated.id,
    metadata: {
      before: { title: existing.title, status: existing.status, location: existing.location },
      after: { title: updated.title, status: updated.status, location: updated.location },
    },
  });

  return { ok: true, data: updated };
}
