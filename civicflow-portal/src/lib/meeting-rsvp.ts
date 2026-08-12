import type { MeetingRsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { getRsvpMode } from "@/lib/event-rsvp";

/**
 * Core Meeting RSVP — the Meeting counterpart of the Event RSVP service in
 * src/lib/event-rsvp.ts, sharing its capability contract (getRsvpMode /
 * resolveRsvpCapability / EventRsvpBlock builders are imported, never
 * duplicated) while persisting to the PARALLEL MeetingRsvp model. RSVP is
 * intent; AttendanceRecord remains the sole record of actual presence — the
 * two never mix.
 *
 * PTA household meeting RSVP lives in src/lib/labs/pta/meetings.ts
 * (PtaMeetingRsvp), exactly as PTA event RSVP lives beside EventRsvp.
 */

export const MEETING_RSVP_ERROR_CODES = [
  /** The org's RSVP mode is not "individual" — PTA (household is
   * authoritative) and HOA (mode none) callers are rejected here. */
  "MEETING_RSVP_NOT_AVAILABLE",
  "MEETING_RSVP_ORGANIZATION_NOT_FOUND",
  "MEETING_RSVP_MEETING_NOT_FOUND",
  "MEETING_RSVP_MEMBER_NOT_FOUND",
] as const;

export type MeetingRsvpErrorCode = (typeof MEETING_RSVP_ERROR_CODES)[number];

const STATUS_FOR_CODE: Record<MeetingRsvpErrorCode, number> = {
  MEETING_RSVP_NOT_AVAILABLE: 403,
  MEETING_RSVP_ORGANIZATION_NOT_FOUND: 404,
  MEETING_RSVP_MEETING_NOT_FOUND: 404,
  MEETING_RSVP_MEMBER_NOT_FOUND: 404,
};

export class MeetingRsvpError extends Error {
  readonly code: MeetingRsvpErrorCode;
  readonly status: number;

  constructor(code: MeetingRsvpErrorCode, message: string) {
    super(message);
    this.name = "MeetingRsvpError";
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
  }
}

/**
 * Create or update the member's RSVP for a meeting — upserted by
 * (meetingId, orgMemberId), idempotent by construction. Tenant integrity is
 * re-verified here: meeting AND member must both belong to organizationId,
 * and the org's RSVP mode must actually be "individual".
 */
export async function setMeetingRsvp(
  organizationId: string,
  meetingId: string,
  orgMemberId: string,
  input: { status: MeetingRsvpStatus },
  actorUserId: string,
  actorEmail?: string | null
) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { primaryVertical: true },
  });
  if (!organization) throw new MeetingRsvpError("MEETING_RSVP_ORGANIZATION_NOT_FOUND", "Organization not found.");
  if (getRsvpMode(organization.primaryVertical) !== "individual") {
    throw new MeetingRsvpError("MEETING_RSVP_NOT_AVAILABLE", "RSVP is not available for this organization's meetings.");
  }

  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, organizationId }, select: { id: true } });
  if (!meeting) throw new MeetingRsvpError("MEETING_RSVP_MEETING_NOT_FOUND", "Meeting not found in this organization.");

  const member = await prisma.orgMember.findFirst({ where: { id: orgMemberId, organizationId }, select: { id: true } });
  if (!member) throw new MeetingRsvpError("MEETING_RSVP_MEMBER_NOT_FOUND", "Member record not found in this organization.");

  const rsvp = await prisma.meetingRsvp.upsert({
    where: { meetingId_orgMemberId: { meetingId, orgMemberId } },
    create: { organizationId, meetingId, orgMemberId, status: input.status },
    update: { status: input.status },
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "meeting_rsvp.set",
    entityType: "meeting_rsvp",
    entityId: rsvp.id,
    metadata: { meetingId, orgMemberId, status: input.status },
  });

  return rsvp;
}

export async function listMeetingRsvps(organizationId: string, meetingId: string) {
  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, organizationId }, select: { id: true } });
  if (!meeting) throw new MeetingRsvpError("MEETING_RSVP_MEETING_NOT_FOUND", "Meeting not found in this organization.");
  return prisma.meetingRsvp.findMany({
    where: { organizationId, meetingId },
    include: { orgMember: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Officer-facing summary. For individual RSVP one GOING row IS one expected
 * attendee (same metric rule as getEventRsvpSummary); the PTA counterpart in
 * labs/pta/meetings.ts sums household attendeeCount instead. Cross-vertical
 * displays must aggregate ATTENDEES, never raw row counts.
 */
export async function getMeetingRsvpSummary(organizationId: string, meetingId: string) {
  const rsvps = await listMeetingRsvps(organizationId, meetingId);
  return {
    membersGoing: rsvps.filter((r) => r.status === "GOING").length,
    membersMaybe: rsvps.filter((r) => r.status === "MAYBE").length,
    membersNotGoing: rsvps.filter((r) => r.status === "NOT_GOING").length,
    totalAttendees: rsvps.filter((r) => r.status === "GOING").length,
  };
}
