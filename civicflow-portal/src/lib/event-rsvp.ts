import type { EventRsvpStatus, OrganizationVertical } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";

/**
 * Core Event RSVP — capability contract + individual (per-OrgMember) RSVP
 * service.
 *
 * The organization's RSVP capability — not the shape of an event object, not
 * the caller's identity fields — is the single authority for which RSVP model
 * an event uses:
 *
 *   PTA       → mode "household"  (PtaEventRsvp, one row per PtaHousehold,
 *                guest counts — see src/lib/labs/pta/events.ts, unchanged)
 *   COMMUNITY → mode "individual" (EventRsvp, one row per OrgMember)
 *   UNION     → mode "individual"
 *   HOA       → mode "none"       (resident-vs-property RSVP semantics are an
 *                open product decision; nothing is offered until it's made)
 *
 * This retires the client-side `'myRsvp' in event` / `hasMemberIdentity ?
 * generic : PTA` discrimination that caused the Build 9 production regression
 * (see mobile-organizations-route.test.ts's "PTA household routing wins"
 * suite).
 */

export type RsvpMode = "household" | "individual" | "none";

export interface RsvpCapability {
  mode: RsvpMode;
  /** Whether responses carry a meaningful attendee/guest count (household
   * RSVP only — an individual RSVP always represents exactly one attendee). */
  guestCounts: boolean;
  /** Whether THIS caller holds the identity the mode requires (a household
   * link for "household", a linked OrgMember for "individual"). A staff-only
   * login with neither identity gets false regardless of role. */
  canRsvp: boolean;
}

export interface RsvpIdentity {
  /** Caller has a PtaHouseholdAdult link in this org. */
  hasHouseholdIdentity: boolean;
  /** Caller has a linked OrgMember in this org (any role — see PR #89's
   * dual-identity architecture; role is deliberately not consulted). */
  hasMemberIdentity: boolean;
}

export function getRsvpMode(vertical: OrganizationVertical): RsvpMode {
  switch (vertical) {
    case "PTA":
      return "household";
    case "COMMUNITY":
    case "UNION":
      return "individual";
    case "HOA":
      return "none";
  }
}

export function resolveRsvpCapability(vertical: OrganizationVertical, identity: RsvpIdentity): RsvpCapability {
  const mode = getRsvpMode(vertical);
  return {
    mode,
    guestCounts: mode === "household",
    canRsvp:
      mode === "household" ? identity.hasHouseholdIdentity : mode === "individual" ? identity.hasMemberIdentity : false,
  };
}

/**
 * The one RSVP shape every event response exposes, regardless of vertical —
 * PTA and generic event endpoints both attach this block, so the mobile
 * client reads `event.rsvp` and never infers the mode from anything else.
 * Differences between verticals live INSIDE this block, never as entirely
 * different event object shapes.
 */
export interface EventRsvpBlock {
  mode: RsvpMode;
  canRsvp: boolean;
  guestCounts: boolean;
  response: { status: EventRsvpStatus; attendeeCount: number } | null;
  /** Whose RSVP `response` is (and would be written as): the caller's
   * household for PTA, their OrgMember for Community/Union. Type "none" when
   * the caller holds no RSVP-capable identity or the org's mode is "none". */
  subject: { type: "household" | "member" | "none"; id: string | null };
}

export function buildHouseholdRsvpBlock(
  householdId: string,
  response: { status: EventRsvpStatus; attendeeCount: number } | null
): EventRsvpBlock {
  return {
    mode: "household",
    canRsvp: true,
    guestCounts: true,
    response,
    subject: { type: "household", id: householdId },
  };
}

export function buildIndividualRsvpBlock(
  orgMemberId: string | null,
  response: { status: EventRsvpStatus } | null
): EventRsvpBlock {
  return {
    mode: "individual",
    canRsvp: orgMemberId !== null,
    guestCounts: false,
    // One individual RSVP always represents exactly one attendee.
    response: response ? { status: response.status, attendeeCount: 1 } : null,
    subject: orgMemberId ? { type: "member", id: orgMemberId } : { type: "none", id: null },
  };
}

export function buildNoRsvpBlock(mode: "household" | "none" = "none"): EventRsvpBlock {
  return {
    mode,
    canRsvp: false,
    guestCounts: mode === "household",
    response: null,
    subject: { type: "none", id: null },
  };
}

// ── Errors (mirrors labs/pta/errors.ts's fixed code→status pattern) ────────

export const EVENT_RSVP_ERROR_CODES = [
  /** The org's RSVP mode is not "individual" — covers HOA (mode none) and
   * PTA (household RSVP is authoritative there; a linked OrgMember must
   * never redirect a PTA caller onto the generic model). */
  "EVENT_RSVP_NOT_AVAILABLE",
  "EVENT_RSVP_ORGANIZATION_NOT_FOUND",
  "EVENT_RSVP_EVENT_NOT_FOUND",
  "EVENT_RSVP_MEMBER_NOT_FOUND",
] as const;

export type EventRsvpErrorCode = (typeof EVENT_RSVP_ERROR_CODES)[number];

const STATUS_FOR_CODE: Record<EventRsvpErrorCode, number> = {
  EVENT_RSVP_NOT_AVAILABLE: 403,
  EVENT_RSVP_ORGANIZATION_NOT_FOUND: 404,
  EVENT_RSVP_EVENT_NOT_FOUND: 404,
  EVENT_RSVP_MEMBER_NOT_FOUND: 404,
};

export class EventRsvpError extends Error {
  readonly code: EventRsvpErrorCode;
  readonly status: number;

  constructor(code: EventRsvpErrorCode, message: string) {
    super(message);
    this.name = "EventRsvpError";
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
  }
}

// ── Individual RSVP service ────────────────────────────────────────────────

/**
 * Create or update the member's RSVP for an event — upserted by
 * (eventId, orgMemberId), so a duplicate tap is a no-op update rather than a
 * duplicate row (idempotent by construction, same property as
 * setPtaEventRsvp()).
 *
 * Tenant integrity is re-verified here even though callers resolve
 * orgMemberId server-side: the event AND the member must both belong to
 * organizationId, and the org's RSVP mode must actually be "individual" —
 * never assumed from IDs coincidentally lining up downstream.
 */
export async function setEventRsvp(
  organizationId: string,
  eventId: string,
  orgMemberId: string,
  input: { status: EventRsvpStatus },
  actorUserId: string,
  actorEmail?: string | null
) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { primaryVertical: true },
  });
  if (!organization) throw new EventRsvpError("EVENT_RSVP_ORGANIZATION_NOT_FOUND", "Organization not found.");
  if (getRsvpMode(organization.primaryVertical) !== "individual") {
    throw new EventRsvpError("EVENT_RSVP_NOT_AVAILABLE", "RSVP is not available for this organization's events.");
  }

  const event = await prisma.event.findFirst({ where: { id: eventId, organizationId }, select: { id: true } });
  if (!event) throw new EventRsvpError("EVENT_RSVP_EVENT_NOT_FOUND", "Event not found in this organization.");

  const member = await prisma.orgMember.findFirst({ where: { id: orgMemberId, organizationId }, select: { id: true } });
  if (!member) throw new EventRsvpError("EVENT_RSVP_MEMBER_NOT_FOUND", "Member record not found in this organization.");

  const rsvp = await prisma.eventRsvp.upsert({
    where: { eventId_orgMemberId: { eventId, orgMemberId } },
    create: { organizationId, eventId, orgMemberId, status: input.status },
    update: { status: input.status },
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "event_rsvp.set",
    entityType: "event_rsvp",
    entityId: rsvp.id,
    metadata: { eventId, orgMemberId, status: input.status },
  });

  return rsvp;
}

export async function listEventRsvps(organizationId: string, eventId: string) {
  const event = await prisma.event.findFirst({ where: { id: eventId, organizationId }, select: { id: true } });
  if (!event) throw new EventRsvpError("EVENT_RSVP_EVENT_NOT_FOUND", "Event not found in this organization.");
  return prisma.eventRsvp.findMany({
    where: { organizationId, eventId },
    include: { orgMember: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Officer-facing summary. NOTE the deliberate metric difference from PTA:
 * here one GOING row IS one attendee (individual RSVP has no guest counts),
 * whereas PTA's getPtaEventAttendanceSummary() sums attendeeCount because one
 * household row can represent several people. Anything displaying a
 * cross-vertical figure must aggregate ATTENDEES (this count / PTA's
 * totalAttendees), never raw row counts.
 */
export async function getEventRsvpSummary(organizationId: string, eventId: string) {
  const rsvps = await listEventRsvps(organizationId, eventId);
  return {
    membersGoing: rsvps.filter((r) => r.status === "GOING").length,
    membersMaybe: rsvps.filter((r) => r.status === "MAYBE").length,
    membersNotGoing: rsvps.filter((r) => r.status === "NOT_GOING").length,
    /** Equal to membersGoing by definition for individual RSVP. */
    totalAttendees: rsvps.filter((r) => r.status === "GOING").length,
  };
}
