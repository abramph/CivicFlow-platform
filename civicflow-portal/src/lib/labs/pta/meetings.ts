import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";

/**
 * Household-level Meeting RSVP — mirrors ./events.ts's PtaEventRsvp
 * functions exactly, persisting to the parallel PtaMeetingRsvp model (Core
 * Meeting RSVP program). One household row can represent several attendees
 * (attendeeCount); summaries aggregate attendees, never rows.
 */

export async function setPtaMeetingRsvp(
  organizationId: string,
  meetingId: string,
  householdId: string,
  input: { status: "GOING" | "NOT_GOING" | "MAYBE"; attendeeCount?: number },
  actorUserId: string,
  actorEmail?: string | null
) {
  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, organizationId } });
  if (!meeting) throw new PtaError("PTA_MEETING_NOT_FOUND", "Meeting not found in this organization.");
  const household = await prisma.ptaHousehold.findFirst({ where: { id: householdId, organizationId } });
  if (!household) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");

  // Same head-count semantics as setPtaEventRsvp: NOT_GOING records 0
  // expected attendees; GOING/MAYBE keep the household-supplied count (>= 1).
  const attendeeCount = input.status === "NOT_GOING" ? 0 : (input.attendeeCount ?? 1);
  if (input.status !== "NOT_GOING" && (!Number.isInteger(attendeeCount) || attendeeCount < 1)) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Attendee count must be a positive integer.");
  }

  const rsvp = await prisma.ptaMeetingRsvp.upsert({
    where: { meetingId_householdId: { meetingId, householdId } },
    create: { organizationId, meetingId, householdId, status: input.status, attendeeCount },
    update: { status: input.status, attendeeCount },
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.meeting_rsvp.set",
    entityType: "pta_meeting_rsvp",
    entityId: rsvp.id,
    metadata: { meetingId, status: input.status },
  });

  return rsvp;
}

export async function listPtaMeetingRsvps(organizationId: string, meetingId: string) {
  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, organizationId } });
  if (!meeting) throw new PtaError("PTA_MEETING_NOT_FOUND", "Meeting not found in this organization.");
  return prisma.ptaMeetingRsvp.findMany({ where: { organizationId, meetingId }, include: { household: { select: { id: true, displayName: true } } } });
}

export async function getPtaMeetingAttendanceSummary(organizationId: string, meetingId: string) {
  const rsvps = await listPtaMeetingRsvps(organizationId, meetingId);
  const going = rsvps.filter((r) => r.status === "GOING");
  return {
    householdsGoing: going.length,
    totalAttendees: going.reduce((sum, r) => sum + r.attendeeCount, 0),
    householdsMaybe: rsvps.filter((r) => r.status === "MAYBE").length,
    householdsNotGoing: rsvps.filter((r) => r.status === "NOT_GOING").length,
  };
}
