import type { EventRsvpStatus, MeetingRsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import {
  getRsvpMode,
  type AdminEventRsvpView,
  type AdminRsvpCounts,
  type AdminRsvpCountsResult,
} from "@/lib/event-rsvp";
import { getPtaMeetingAttendanceSummary, listPtaMeetingRsvps } from "@/lib/labs/pta/meetings";

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

// ── Officer/admin-facing RSVP view (Meeting twin of the Event versions) ────

/** Same shape as the admin EVENT view on purpose: one client component can
 * render either. Reuses this module's own list/summary services and the PTA
 * meeting services — never a new aggregation path. */
export type AdminMeetingRsvpView = AdminEventRsvpView;

/**
 * The RSVP block for an ADMIN meeting payload. Callers must have already
 * enforced the appropriate administrative gate (meetings:write / the mobile
 * manageMeetings flag) and verified the meeting belongs to organizationId;
 * the underlying list services re-verify meeting tenancy themselves.
 */
export async function getAdminMeetingRsvpView(organizationId: string, meetingId: string): Promise<AdminMeetingRsvpView> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { primaryVertical: true },
  });
  const mode = organization ? getRsvpMode(organization.primaryVertical) : "none";

  if (mode === "household") {
    const [summary, rows] = await Promise.all([
      getPtaMeetingAttendanceSummary(organizationId, meetingId),
      listPtaMeetingRsvps(organizationId, meetingId),
    ]);
    return {
      mode,
      guestCounts: true,
      summary: {
        totalResponses: rows.length,
        going: summary.householdsGoing,
        maybe: summary.householdsMaybe,
        notGoing: summary.householdsNotGoing,
        totalAttendees: summary.totalAttendees,
      },
      responses: rows.map((row) => ({
        id: row.id,
        name: row.household.displayName,
        status: row.status as EventRsvpStatus,
        attendeeCount: row.attendeeCount,
        respondedAt: row.updatedAt,
      })),
    };
  }

  if (mode === "individual") {
    const [summary, rows] = await Promise.all([
      getMeetingRsvpSummary(organizationId, meetingId),
      listMeetingRsvps(organizationId, meetingId),
    ]);
    return {
      mode,
      guestCounts: false,
      summary: {
        totalResponses: rows.length,
        going: summary.membersGoing,
        maybe: summary.membersMaybe,
        notGoing: summary.membersNotGoing,
        totalAttendees: summary.totalAttendees,
      },
      responses: rows.map((row) => ({
        id: row.id,
        name: `${row.orgMember.firstName} ${row.orgMember.lastName}`.trim(),
        status: row.status,
        attendeeCount: null,
        respondedAt: row.updatedAt,
      })),
    };
  }

  return { mode: "none", guestCounts: false, summary: null, responses: [] };
}

/**
 * Batched planning counts for MANY meetings — the Meeting twin of
 * getAdminEventRsvpCounts, same normative math and the same structural
 * tenancy (organizationId WHERE-scopes every grouped row).
 */
export async function getAdminMeetingRsvpCounts(organizationId: string, meetingIds: string[]): Promise<AdminRsvpCountsResult> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { primaryVertical: true },
  });
  const mode = organization ? getRsvpMode(organization.primaryVertical) : "none";
  const guestCounts = mode === "household";
  const byId: Record<string, AdminRsvpCounts> = {};
  if (mode === "none" || meetingIds.length === 0) return { mode, guestCounts, byId };

  const ensure = (id: string) =>
    (byId[id] ??= { totalResponses: 0, going: 0, maybe: 0, notGoing: 0, totalAttendees: 0 });

  if (mode === "household") {
    const groups = await prisma.ptaMeetingRsvp.groupBy({
      by: ["meetingId", "status"],
      where: { organizationId, meetingId: { in: meetingIds } },
      _count: { _all: true },
      _sum: { attendeeCount: true },
    });
    for (const group of groups) {
      const counts = ensure(group.meetingId);
      counts.totalResponses += group._count._all;
      if (group.status === "GOING") {
        counts.going += group._count._all;
        counts.totalAttendees += group._sum.attendeeCount ?? 0;
      } else if (group.status === "MAYBE") counts.maybe += group._count._all;
      else counts.notGoing += group._count._all;
    }
  } else {
    const groups = await prisma.meetingRsvp.groupBy({
      by: ["meetingId", "status"],
      where: { organizationId, meetingId: { in: meetingIds } },
      _count: { _all: true },
    });
    for (const group of groups) {
      const counts = ensure(group.meetingId);
      counts.totalResponses += group._count._all;
      if (group.status === "GOING") {
        counts.going += group._count._all;
        counts.totalAttendees += group._count._all;
      } else if (group.status === "MAYBE") counts.maybe += group._count._all;
      else counts.notGoing += group._count._all;
    }
  }

  return { mode, guestCounts, byId };
}
