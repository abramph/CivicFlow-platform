import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";

/** Household-level RSVP for the existing (unmodified) Event model. QR check-in remains meeting-scoped only in this MVP — see docs/pta-labs-mvp.md's "Known limitations" for why event-level QR check-in is deliberately deferred rather than attempted. */

export async function setPtaEventRsvp(
  organizationId: string,
  eventId: string,
  householdId: string,
  input: { status: "GOING" | "NOT_GOING" | "MAYBE"; attendeeCount?: number },
  actorUserId: string,
  actorEmail?: string | null
) {
  const event = await prisma.event.findFirst({ where: { id: eventId, organizationId } });
  if (!event) throw new PtaError("PTA_EVENT_NOT_FOUND", "Event not found in this organization.");
  const household = await prisma.ptaHousehold.findFirst({ where: { id: householdId, organizationId } });
  if (!household) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");

  // Head-count semantics (PTA RSVP head-count requirement): NOT_GOING always
  // records 0 expected attendees, regardless of any submitted count — old
  // mobile builds unconditionally send attendeeCount 1, which must not read
  // as "one attendee from a household that said no". GOING/MAYBE keep the
  // household-supplied count (>= 1, defaulting to 1).
  const attendeeCount = input.status === "NOT_GOING" ? 0 : (input.attendeeCount ?? 1);
  if (input.status !== "NOT_GOING" && (!Number.isInteger(attendeeCount) || attendeeCount < 1)) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Attendee count must be a positive integer.");
  }

  const rsvp = await prisma.ptaEventRsvp.upsert({
    where: { eventId_householdId: { eventId, householdId } },
    create: { organizationId, eventId, householdId, status: input.status, attendeeCount },
    update: { status: input.status, attendeeCount },
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.event_rsvp.set",
    entityType: "pta_event_rsvp",
    entityId: rsvp.id,
    metadata: { eventId, status: input.status },
  });

  return rsvp;
}

export async function listPtaEventRsvps(organizationId: string, eventId: string) {
  const event = await prisma.event.findFirst({ where: { id: eventId, organizationId } });
  if (!event) throw new PtaError("PTA_EVENT_NOT_FOUND", "Event not found in this organization.");
  return prisma.ptaEventRsvp.findMany({ where: { organizationId, eventId }, include: { household: { select: { id: true, displayName: true } } } });
}

export async function getPtaEventAttendanceSummary(organizationId: string, eventId: string) {
  const rsvps = await listPtaEventRsvps(organizationId, eventId);
  const going = rsvps.filter((r) => r.status === "GOING");
  return {
    householdsGoing: going.length,
    totalAttendees: going.reduce((sum, r) => sum + r.attendeeCount, 0),
    householdsMaybe: rsvps.filter((r) => r.status === "MAYBE").length,
    householdsNotGoing: rsvps.filter((r) => r.status === "NOT_GOING").length,
  };
}
