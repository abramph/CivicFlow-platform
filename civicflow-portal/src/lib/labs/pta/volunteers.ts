import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";

/**
 * Volunteer opportunities, shifts ("slots"), assignments ("signups"),
 * attendance, and the volunteer-hours ledger.
 *
 * Three deliberately separate facts, matching the module's design principle
 * — never collapse these into one mutable status field:
 *   1. PtaVolunteerSignup   — the intent to show up (a claim or manual assignment)
 *   2. PtaVolunteerAttendance — what actually happened (check-in/out, no-show, ...)
 *   3. PtaVolunteerHourEntry  — the approved credit (the authoritative ledger)
 *
 * Capacity enforcement is a database-level atomic conditional UPDATE — the
 * same pattern as meeting-intelligence/worker.ts's claimQueuedJob() — not a
 * read-then-write application check, so it's actually race-safe under
 * concurrent signups, not just safe in the common case.
 */

const MAX_CREDITED_MINUTES = 24 * 60; // Safety bound — a single shift's credited hours can never exceed a full day.

// ─── Opportunities ──────────────────────────────────────────────────────────

export interface CreateOpportunityInput {
  organizationId: string;
  title: string;
  eventId?: string | null;
  committeeId?: string | null;
  description?: string | null;
  instructions?: string | null;
  schoolYear?: string | null;
  coordinatorUserId?: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
  signupDeadline?: Date | null;
  cancellationDeadline?: Date | null;
  supplyRequest?: string | null;
  status?: "DRAFT" | "OPEN";
  actorUserId: string;
  actorEmail?: string | null;
}

export async function createPtaVolunteerOpportunity(input: CreateOpportunityInput) {
  if (!input.title.trim()) throw new PtaError("PTA_VALIDATION_ERROR", "Opportunity title is required.");
  if (input.eventId) {
    const event = await prisma.event.findFirst({ where: { id: input.eventId, organizationId: input.organizationId } });
    if (!event) throw new PtaError("PTA_EVENT_NOT_FOUND", "Event not found in this organization.");
  }
  if (input.committeeId) {
    const committee = await prisma.ptaCommittee.findFirst({ where: { id: input.committeeId, organizationId: input.organizationId } });
    if (!committee) throw new PtaError("PTA_COMMITTEE_NOT_FOUND", "Committee not found in this organization.");
  }

  const opportunity = await prisma.ptaVolunteerOpportunity.create({
    data: {
      organizationId: input.organizationId,
      title: input.title,
      eventId: input.eventId ?? null,
      committeeId: input.committeeId ?? null,
      description: input.description ?? null,
      instructions: input.instructions ?? null,
      schoolYear: input.schoolYear ?? null,
      coordinatorUserId: input.coordinatorUserId ?? null,
      startAt: input.startAt ?? null,
      endAt: input.endAt ?? null,
      signupDeadline: input.signupDeadline ?? null,
      cancellationDeadline: input.cancellationDeadline ?? null,
      supplyRequest: input.supplyRequest ?? null,
      status: input.status ?? "OPEN",
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.volunteer_opportunity.created",
    entityType: "pta_volunteer_opportunity",
    entityId: opportunity.id,
    metadata: { status: opportunity.status },
  });

  return opportunity;
}

export interface UpdateOpportunityInput {
  title?: string;
  eventId?: string | null;
  description?: string | null;
  instructions?: string | null;
  coordinatorUserId?: string | null;
  committeeId?: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
  signupDeadline?: Date | null;
  cancellationDeadline?: Date | null;
  supplyRequest?: string | null;
}

export async function updatePtaVolunteerOpportunity(
  organizationId: string,
  opportunityId: string,
  input: UpdateOpportunityInput,
  actorUserId: string,
  actorEmail?: string | null
) {
  const existing = await prisma.ptaVolunteerOpportunity.findFirst({ where: { id: opportunityId, organizationId } });
  if (!existing) throw new PtaError("PTA_OPPORTUNITY_NOT_FOUND", "Volunteer opportunity not found in this organization.");
  if (input.title !== undefined && !input.title.trim()) throw new PtaError("PTA_VALIDATION_ERROR", "Opportunity title cannot be blank.");
  if (input.eventId) {
    const event = await prisma.event.findFirst({ where: { id: input.eventId, organizationId } });
    if (!event) throw new PtaError("PTA_EVENT_NOT_FOUND", "Event not found in this organization.");
  }

  const updated = await prisma.ptaVolunteerOpportunity.update({
    where: { id: opportunityId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
      ...(input.coordinatorUserId !== undefined ? { coordinatorUserId: input.coordinatorUserId } : {}),
      ...(input.committeeId !== undefined ? { committeeId: input.committeeId } : {}),
      ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
      ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
      ...(input.signupDeadline !== undefined ? { signupDeadline: input.signupDeadline } : {}),
      ...(input.cancellationDeadline !== undefined ? { cancellationDeadline: input.cancellationDeadline } : {}),
      ...(input.supplyRequest !== undefined ? { supplyRequest: input.supplyRequest } : {}),
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_opportunity.updated",
    entityType: "pta_volunteer_opportunity",
    entityId: opportunityId,
    metadata: { fields: Object.keys(input) },
  });

  return updated;
}

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["OPEN", "CANCELLED", "ARCHIVED"],
  OPEN: ["CLOSED", "CANCELLED"],
  CLOSED: ["OPEN", "COMPLETED", "CANCELLED"],
  COMPLETED: ["ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  ARCHIVED: [],
};

/** Publish/close/cancel/complete/archive — validated against an explicit transition table so an opportunity can never silently skip a state (e.g. DRAFT straight to COMPLETED). */
export async function setPtaVolunteerOpportunityStatus(
  organizationId: string,
  opportunityId: string,
  nextStatus: "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED" | "COMPLETED" | "ARCHIVED",
  actorUserId: string,
  actorEmail?: string | null
) {
  const existing = await prisma.ptaVolunteerOpportunity.findFirst({ where: { id: opportunityId, organizationId } });
  if (!existing) throw new PtaError("PTA_OPPORTUNITY_NOT_FOUND", "Volunteer opportunity not found in this organization.");

  const allowed = VALID_STATUS_TRANSITIONS[existing.status] ?? [];
  if (existing.status !== nextStatus && !allowed.includes(nextStatus)) {
    throw new PtaError("PTA_VALIDATION_ERROR", `Cannot move an opportunity from ${existing.status} to ${nextStatus}.`);
  }

  const updated = await prisma.ptaVolunteerOpportunity.update({ where: { id: opportunityId }, data: { status: nextStatus } });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_opportunity.status_changed",
    entityType: "pta_volunteer_opportunity",
    entityId: opportunityId,
    metadata: { from: existing.status, to: nextStatus },
  });

  return updated;
}

/** Clones an opportunity's fields and shift structure (not its signups/attendance/hours) as a new DRAFT — for a recurring activity like "Book Fair" year over year. */
export async function duplicatePtaVolunteerOpportunity(organizationId: string, opportunityId: string, actorUserId: string, actorEmail?: string | null) {
  const source = await prisma.ptaVolunteerOpportunity.findFirst({ where: { id: opportunityId, organizationId }, include: { slots: true } });
  if (!source) throw new PtaError("PTA_OPPORTUNITY_NOT_FOUND", "Volunteer opportunity not found in this organization.");

  const clone = await prisma.ptaVolunteerOpportunity.create({
    data: {
      organizationId,
      title: `${source.title} (copy)`,
      eventId: null, // Deliberately not carried over — a duplicated opportunity is very unlikely to belong to the same dated Event.
      committeeId: source.committeeId,
      description: source.description,
      instructions: source.instructions,
      schoolYear: source.schoolYear,
      coordinatorUserId: source.coordinatorUserId,
      supplyRequest: source.supplyRequest,
      status: "DRAFT",
    },
  });

  for (const slot of source.slots) {
    await prisma.ptaVolunteerSlot.create({
      data: {
        organizationId,
        opportunityId: clone.id,
        label: slot.label,
        capacity: slot.capacity,
        minNeeded: slot.minNeeded,
        defaultCreditedMinutes: slot.defaultCreditedMinutes,
        locationOverride: slot.locationOverride,
        sortOrder: slot.sortOrder,
      },
    });
  }

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_opportunity.duplicated",
    entityType: "pta_volunteer_opportunity",
    entityId: clone.id,
    metadata: { sourceOpportunityId: opportunityId },
  });

  return clone;
}

export async function listPtaVolunteerOpportunities(organizationId: string, filters: { status?: string; schoolYear?: string } = {}) {
  return prisma.ptaVolunteerOpportunity.findMany({
    where: {
      organizationId,
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.schoolYear ? { schoolYear: filters.schoolYear } : {}),
    },
    include: {
      committee: { select: { id: true, name: true } },
      event: { select: { id: true, title: true, startAt: true } },
      slots: {
        orderBy: { sortOrder: "asc" },
        include: {
          signups: { where: { status: { in: ["SIGNED_UP", "WAITLISTED"] } }, include: { householdAdult: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Full detail for a single opportunity — every signup regardless of status, with attendance and hour-entry data, for the officer management screen. */
export async function getPtaVolunteerOpportunity(organizationId: string, opportunityId: string) {
  const opportunity = await prisma.ptaVolunteerOpportunity.findFirst({
    where: { id: opportunityId, organizationId },
    include: {
      committee: { select: { id: true, name: true } },
      event: { select: { id: true, title: true, startAt: true } },
      slots: {
        orderBy: { sortOrder: "asc" },
        include: {
          signups: {
            include: {
              householdAdult: { select: { id: true, name: true, householdId: true } },
              attendance: true,
              hourEntries: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
        },
      },
    },
  });
  if (!opportunity) throw new PtaError("PTA_OPPORTUNITY_NOT_FOUND", "Volunteer opportunity not found in this organization.");
  return opportunity;
}

// ─── Shifts ("slots") ───────────────────────────────────────────────────────

export interface AddSlotInput {
  label?: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
  capacity: number;
  minNeeded?: number | null;
  defaultCreditedMinutes?: number | null;
  locationOverride?: string | null;
  sortOrder?: number;
}

function assertValidShiftWindow(startAt: Date | null | undefined, endAt: Date | null | undefined) {
  if (startAt && endAt && endAt.getTime() <= startAt.getTime()) {
    throw new PtaError("PTA_VALIDATION_ERROR", "A shift's end time must be after its start time.");
  }
}

export async function addPtaVolunteerSlot(organizationId: string, opportunityId: string, input: AddSlotInput, actorUserId: string, actorEmail?: string | null) {
  const opportunity = await prisma.ptaVolunteerOpportunity.findFirst({ where: { id: opportunityId, organizationId } });
  if (!opportunity) throw new PtaError("PTA_OPPORTUNITY_NOT_FOUND", "Volunteer opportunity not found in this organization.");
  if (!Number.isInteger(input.capacity) || input.capacity < 1) throw new PtaError("PTA_VALIDATION_ERROR", "Capacity must be a positive integer.");
  assertValidShiftWindow(input.startAt, input.endAt);

  const slot = await prisma.ptaVolunteerSlot.create({
    data: {
      organizationId,
      opportunityId: opportunity.id,
      label: input.label ?? null,
      startAt: input.startAt ?? null,
      endAt: input.endAt ?? null,
      capacity: input.capacity,
      minNeeded: input.minNeeded ?? null,
      defaultCreditedMinutes: input.defaultCreditedMinutes ?? null,
      locationOverride: input.locationOverride ?? null,
      sortOrder: input.sortOrder ?? 0,
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_slot.created",
    entityType: "pta_volunteer_opportunity",
    entityId: opportunity.id,
    metadata: { slotId: slot.id, capacity: input.capacity },
  });

  return slot;
}

export interface UpdateSlotInput {
  label?: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
  capacity?: number;
  minNeeded?: number | null;
  defaultCreditedMinutes?: number | null;
  locationOverride?: string | null;
  status?: "OPEN" | "CLOSED" | "CANCELLED";
}

export async function updatePtaVolunteerSlot(organizationId: string, slotId: string, input: UpdateSlotInput, actorUserId: string, actorEmail?: string | null) {
  const slot = await prisma.ptaVolunteerSlot.findFirst({ where: { id: slotId, organizationId } });
  if (!slot) throw new PtaError("PTA_SLOT_NOT_FOUND", "Volunteer slot not found in this organization.");
  if (input.capacity !== undefined) {
    if (!Number.isInteger(input.capacity) || input.capacity < 1) throw new PtaError("PTA_VALIDATION_ERROR", "Capacity must be a positive integer.");
    if (input.capacity < slot.claimedCount) {
      throw new PtaError("PTA_VALIDATION_ERROR", `Capacity cannot be reduced below the ${slot.claimedCount} volunteer(s) already assigned.`);
    }
  }
  const nextStart = input.startAt !== undefined ? input.startAt : slot.startAt;
  const nextEnd = input.endAt !== undefined ? input.endAt : slot.endAt;
  assertValidShiftWindow(nextStart, nextEnd);

  const updated = await prisma.ptaVolunteerSlot.update({
    where: { id: slotId },
    data: {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
      ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.minNeeded !== undefined ? { minNeeded: input.minNeeded } : {}),
      ...(input.defaultCreditedMinutes !== undefined ? { defaultCreditedMinutes: input.defaultCreditedMinutes } : {}),
      ...(input.locationOverride !== undefined ? { locationOverride: input.locationOverride } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_slot.updated",
    entityType: "pta_volunteer_opportunity",
    entityId: slot.opportunityId,
    metadata: { slotId, fields: Object.keys(input) },
  });

  return updated;
}

/** Refuses to delete a shift with any signup history — cancel it instead so attendance/hour-entry history is never orphaned. */
export async function deletePtaVolunteerSlot(organizationId: string, slotId: string, actorUserId: string, actorEmail?: string | null) {
  const slot = await prisma.ptaVolunteerSlot.findFirst({ where: { id: slotId, organizationId } });
  if (!slot) throw new PtaError("PTA_SLOT_NOT_FOUND", "Volunteer slot not found in this organization.");

  const signupCount = await prisma.ptaVolunteerSignup.count({ where: { slotId } });
  if (signupCount > 0) {
    throw new PtaError("PTA_VALIDATION_ERROR", "This shift has signup history — cancel it instead of deleting it.");
  }

  await prisma.ptaVolunteerSlot.delete({ where: { id: slotId } });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_slot.deleted",
    entityType: "pta_volunteer_opportunity",
    entityId: slot.opportunityId,
    metadata: { slotId },
  });
}

// ─── Signups (assignments) ──────────────────────────────────────────────────

/**
 * Atomically claims one seat in a slot for a household adult. The conditional
 * `UPDATE ... WHERE claimedCount < capacity` (updateMany, count === 1 means
 * won) is what actually prevents overbooking under concurrent signups — a
 * plain "count existing signups then insert" check has a race window between
 * the read and the write that this does not.
 *
 * The claim and the signup upsert are wrapped in a single `$transaction` —
 * caught during the post-implementation hardening review: without this, a
 * failure in the signup upsert (after the claim's `updateMany` already
 * committed) would permanently inflate `claimedCount` with no matching
 * signup row and no way to reconcile it. The `PTA_SLOT_FULL` throw happens
 * inside the transaction callback, so a lost race rolls back cleanly with
 * nothing written at all.
 */
export async function claimPtaVolunteerSlot(organizationId: string, slotId: string, householdAdultId: string, actorUserId: string, actorEmail?: string | null) {
  const slot = await prisma.ptaVolunteerSlot.findFirst({ where: { id: slotId, organizationId }, include: { opportunity: true } });
  if (!slot) throw new PtaError("PTA_SLOT_NOT_FOUND", "Volunteer slot not found in this organization.");
  if (slot.opportunity.status !== "OPEN") throw new PtaError("PTA_OPPORTUNITY_SIGNUP_CLOSED", "This opportunity is not currently open for signups.");
  if (slot.status !== "OPEN") throw new PtaError("PTA_OPPORTUNITY_SIGNUP_CLOSED", "This shift is not currently open for signups.");
  if (slot.opportunity.signupDeadline && slot.opportunity.signupDeadline.getTime() < Date.now()) {
    throw new PtaError("PTA_OPPORTUNITY_SIGNUP_CLOSED", "The signup deadline for this opportunity has passed.");
  }

  const adult = await prisma.ptaHouseholdAdult.findFirst({ where: { id: householdAdultId, organizationId } });
  if (!adult) throw new PtaError("PTA_NOT_A_HOUSEHOLD_MEMBER", "Household adult not found in this organization.");

  const existingSignup = await prisma.ptaVolunteerSignup.findUnique({ where: { slotId_householdAdultId: { slotId, householdAdultId } } });
  if (existingSignup && existingSignup.status === "SIGNED_UP") {
    throw new PtaError("PTA_SIGNUP_ALREADY_EXISTS", "This adult is already signed up for this slot.");
  }

  const signup = await prisma.$transaction(async (tx) => {
    const claim = await tx.ptaVolunteerSlot.updateMany({
      where: { id: slotId, claimedCount: { lt: slot.capacity } },
      data: { claimedCount: { increment: 1 } },
    });
    if (claim.count !== 1) {
      throw new PtaError("PTA_SLOT_FULL", "This volunteer slot is already full.");
    }

    // Re-signing up after a prior cancellation reuses the same unique row
    // (upsert) rather than creating a second one, since (slotId,
    // householdAdultId) is unique regardless of status.
    return tx.ptaVolunteerSignup.upsert({
      where: { slotId_householdAdultId: { slotId, householdAdultId } },
      create: { organizationId, slotId, householdAdultId, householdId: adult.householdId, status: "SIGNED_UP", source: "SELF" },
      update: { status: "SIGNED_UP", source: "SELF", cancelledAt: null, cancelReason: null, signedUpAt: new Date() },
    });
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_signup.claimed",
    entityType: "pta_volunteer_signup",
    entityId: signup.id,
    metadata: { slotId },
  });

  return signup;
}

/**
 * Officer-initiated assignment — the manual-assignment counterpart to
 * claimPtaVolunteerSlot(). Shares the same atomic capacity claim; the only
 * behavioral difference is `overrideCapacity`, which is itself still an
 * atomic conditional update (never a blind write), just against a
 * capacity+1 ceiling, and is always audited with the acting officer's id
 * when used so an overbooked shift is never silent.
 */
export async function manuallyAssignPtaVolunteer(
  organizationId: string,
  slotId: string,
  householdAdultId: string,
  actorUserId: string,
  options: { overrideCapacity?: boolean; notes?: string | null } = {},
  actorEmail?: string | null
) {
  const slot = await prisma.ptaVolunteerSlot.findFirst({ where: { id: slotId, organizationId } });
  if (!slot) throw new PtaError("PTA_SLOT_NOT_FOUND", "Volunteer slot not found in this organization.");

  const adult = await prisma.ptaHouseholdAdult.findFirst({ where: { id: householdAdultId, organizationId } });
  if (!adult) throw new PtaError("PTA_NOT_A_HOUSEHOLD_MEMBER", "Household adult not found in this organization.");

  const existingSignup = await prisma.ptaVolunteerSignup.findUnique({ where: { slotId_householdAdultId: { slotId, householdAdultId } } });
  if (existingSignup && existingSignup.status === "SIGNED_UP") {
    throw new PtaError("PTA_SIGNUP_ALREADY_EXISTS", "This adult is already assigned to this slot.");
  }

  const effectiveCapacity = options.overrideCapacity ? slot.capacity + 1 : slot.capacity;

  const signup = await prisma.$transaction(async (tx) => {
    const claim = await tx.ptaVolunteerSlot.updateMany({
      where: { id: slotId, claimedCount: { lt: effectiveCapacity } },
      data: { claimedCount: { increment: 1 }, ...(options.overrideCapacity ? { capacity: effectiveCapacity } : {}) },
    });
    if (claim.count !== 1) {
      throw new PtaError("PTA_SLOT_FULL", "This volunteer slot is already full.");
    }

    return tx.ptaVolunteerSignup.upsert({
      where: { slotId_householdAdultId: { slotId, householdAdultId } },
      create: {
        organizationId,
        slotId,
        householdAdultId,
        householdId: adult.householdId,
        status: "SIGNED_UP",
        source: "OFFICER_MANUAL",
        manuallyAssigned: true,
        assignedByUserId: actorUserId,
        notes: options.notes ?? null,
      },
      update: {
        status: "SIGNED_UP",
        source: "OFFICER_MANUAL",
        manuallyAssigned: true,
        assignedByUserId: actorUserId,
        notes: options.notes ?? null,
        cancelledAt: null,
        cancelReason: null,
        signedUpAt: new Date(),
      },
    });
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: options.overrideCapacity ? "pta.volunteer_signup.manually_assigned_with_capacity_override" : "pta.volunteer_signup.manually_assigned",
    entityType: "pta_volunteer_signup",
    entityId: signup.id,
    metadata: { slotId, capacityOverridden: Boolean(options.overrideCapacity) },
  });

  return signup;
}

/**
 * Releases the claimed seat back to the slot — the mirror-image atomic
 * decrement of claimPtaVolunteerSlot(). Also wrapped in a transaction so a
 * failure between the status update and the decrement can never leave a
 * signup CANCELLED while the slot's claimedCount still reflects it as
 * occupied. Respects the opportunity's cancellation deadline unless
 * `officerOverride` is set (an officer cancelling on a parent's behalf, or
 * handling a late cancellation at their discretion).
 */
export async function cancelPtaVolunteerSignup(
  organizationId: string,
  slotId: string,
  householdAdultId: string,
  actorUserId: string,
  options: { reason?: string | null; officerOverride?: boolean } = {},
  actorEmail?: string | null
) {
  const signup = await prisma.ptaVolunteerSignup.findFirst({ where: { slotId, householdAdultId, organizationId }, include: { slot: { include: { opportunity: true } } } });
  if (!signup) throw new PtaError("PTA_SIGNUP_NOT_FOUND", "Volunteer signup not found in this organization.");
  if (signup.status !== "SIGNED_UP") return signup;

  const deadline = signup.slot.opportunity.cancellationDeadline;
  if (deadline && deadline.getTime() < Date.now() && !options.officerOverride) {
    throw new PtaError("PTA_CANCELLATION_DEADLINE_PASSED", "The cancellation deadline for this opportunity has passed — contact your volunteer coordinator.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.ptaVolunteerSignup.update({
      where: { id: signup.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: options.reason ?? null },
    });
    await tx.ptaVolunteerSlot.updateMany({ where: { id: slotId, claimedCount: { gt: 0 } }, data: { claimedCount: { decrement: 1 } } });
    return result;
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_signup.cancelled",
    entityType: "pta_volunteer_signup",
    entityId: signup.id,
    metadata: { slotId, reason: options.reason ?? null, officerOverride: Boolean(options.officerOverride) },
  });

  return updated;
}

/** @deprecated Collapses attendance and hours into the signup's own status/hoursLogged — kept only for the pre-existing route/button that already calls it. New work uses checkIn/checkOut + setPtaVolunteerAttendanceStatus + the hour-entry ledger instead, per the module's explicit design principle against collapsing these into one field. */
export async function completePtaVolunteerSignup(organizationId: string, signupId: string, hoursLogged: number | null, actorUserId: string, actorEmail?: string | null) {
  const signup = await prisma.ptaVolunteerSignup.findFirst({ where: { id: signupId, organizationId } });
  if (!signup) throw new PtaError("PTA_SIGNUP_NOT_FOUND", "Volunteer signup not found in this organization.");

  const updated = await prisma.ptaVolunteerSignup.update({
    where: { id: signup.id },
    data: { status: "COMPLETED", completedAt: new Date(), hoursLogged: hoursLogged ?? undefined },
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_signup.completed",
    entityType: "pta_volunteer_signup",
    entityId: signup.id,
    metadata: { hoursLogged: hoursLogged ?? null },
  });

  return updated;
}

/** Every commitment (past and present) for a given household adult — powers "see their commitments" in the parent experience. */
export async function listPtaVolunteerCommitments(organizationId: string, householdAdultId: string) {
  return prisma.ptaVolunteerSignup.findMany({
    where: { organizationId, householdAdultId },
    include: { slot: { include: { opportunity: true } }, attendance: true, hourEntries: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { signedUpAt: "desc" },
  });
}

// ─── Attendance (check-in / check-out) ──────────────────────────────────────

/**
 * Caught live by a concurrency test firing 5 simultaneous check-ins at the
 * same brand-new signup: even `upsert()` isn't a guaranteed atomic
 * operation against Postgres under real concurrent load (it can still issue
 * a plain INSERT that loses a race to another concurrent upsert, surfacing
 * as a P2002 unique-constraint error instead of silently falling back to
 * the UPDATE branch) — the same class of race claimPtaVolunteerSlot's own
 * doc comment warns about. The fix is the standard pattern for this: catch
 * the specific unique-constraint violation on signupId and re-fetch the row
 * the winning concurrent call actually created, rather than letting the
 * error propagate to whichever caller happened to lose the race.
 */
async function getOrCreateAttendance(organizationId: string, signupId: string) {
  const signup = await prisma.ptaVolunteerSignup.findFirst({ where: { id: signupId, organizationId }, include: { slot: true } });
  if (!signup) throw new PtaError("PTA_SIGNUP_NOT_FOUND", "Volunteer signup not found in this organization.");
  try {
    return await prisma.ptaVolunteerAttendance.upsert({
      where: { signupId },
      create: { organizationId, signupId, scheduledStart: signup.slot.startAt, scheduledEnd: signup.slot.endAt },
      update: {},
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.ptaVolunteerAttendance.findUniqueOrThrow({ where: { signupId } });
    }
    throw error;
  }
}

/** Idempotent — a second check-in click just returns the existing checkInAt rather than overwriting it, so repeated taps on a spotty event-day connection never lose the original timestamp. Server-generated timestamp only; a client-supplied time is never trusted. */
/**
 * The conditional `updateMany ... WHERE checkInAt IS NULL` (not a plain
 * `update`) is what actually makes this idempotent under concurrency — a
 * live test firing 5 simultaneous check-ins for the same signup caught the
 * plain-`update` version stamping 5 *different* timestamps (last write
 * wins), the same class of bug claimPtaVolunteerSlot's capacity claim
 * already guards against. count === 1 means this call won the race and its
 * own timestamp is authoritative; count === 0 means another concurrent call
 * already won, so the real row is re-fetched rather than trusting this
 * call's own (never-written) timestamp.
 */
export async function checkInPtaVolunteer(organizationId: string, signupId: string, actorUserId: string, actorEmail?: string | null) {
  const attendance = await getOrCreateAttendance(organizationId, signupId);
  if (attendance.checkInAt) return attendance;

  const checkInAt = new Date();
  const claim = await prisma.ptaVolunteerAttendance.updateMany({
    where: { id: attendance.id, checkInAt: null },
    data: { checkInAt, recordedByUserId: actorUserId, source: "OFFICER_MANUAL" },
  });

  if (claim.count !== 1) {
    return prisma.ptaVolunteerAttendance.findUniqueOrThrow({ where: { id: attendance.id } });
  }

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_attendance.checked_in",
    entityType: "pta_volunteer_signup",
    entityId: signupId,
    metadata: {},
  });

  return { ...attendance, checkInAt, recordedByUserId: actorUserId, source: "OFFICER_MANUAL" as const };
}

/** Idempotent (same rationale as check-in). Refuses a check-out with no prior check-in, and a check-out time before check-in, rather than silently producing a negative duration. */
/** Same conditional-updateMany idempotency pattern as checkInPtaVolunteer(), for the same reason. */
export async function checkOutPtaVolunteer(organizationId: string, signupId: string, actorUserId: string, actorEmail?: string | null) {
  const attendance = await getOrCreateAttendance(organizationId, signupId);
  if (!attendance.checkInAt) throw new PtaError("PTA_ATTENDANCE_INVALID_TIMES", "Cannot check out a volunteer who hasn't checked in.");
  if (attendance.checkOutAt) return attendance;

  const checkOutAt = new Date();
  if (checkOutAt.getTime() < attendance.checkInAt.getTime()) {
    throw new PtaError("PTA_ATTENDANCE_INVALID_TIMES", "Check-out time cannot precede check-in time.");
  }

  const claim = await prisma.ptaVolunteerAttendance.updateMany({
    where: { id: attendance.id, checkOutAt: null },
    data: { checkOutAt },
  });

  if (claim.count !== 1) {
    return prisma.ptaVolunteerAttendance.findUniqueOrThrow({ where: { id: attendance.id } });
  }

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_attendance.checked_out",
    entityType: "pta_volunteer_signup",
    entityId: signupId,
    metadata: {},
  });

  return { ...attendance, checkOutAt };
}

/**
 * Precedence for the minutes credited when an attendance outcome is
 * recorded (documented in docs/pta-volunteer-management.md):
 *   1. Explicit officer-entered minutes (manualMinutes)
 *   2. Actual check-in/check-out duration
 *   3. The shift's own scheduled start/end duration
 *   4. The shift's defaultCreditedMinutes, when no times exist at all
 *   5. Zero — never fabricate credit for a shift with no time information
 * Always bounded to MAX_CREDITED_MINUTES and never negative.
 */
function computeCreditedMinutes(input: {
  manualMinutes?: number | null;
  checkInAt?: Date | null;
  checkOutAt?: Date | null;
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
  defaultCreditedMinutes?: number | null;
}): number {
  let minutes: number;
  if (input.manualMinutes != null) {
    minutes = input.manualMinutes;
  } else if (input.checkInAt && input.checkOutAt) {
    minutes = Math.round((input.checkOutAt.getTime() - input.checkInAt.getTime()) / 60000);
  } else if (input.scheduledStart && input.scheduledEnd) {
    minutes = Math.round((input.scheduledEnd.getTime() - input.scheduledStart.getTime()) / 60000);
  } else if (input.defaultCreditedMinutes != null) {
    minutes = input.defaultCreditedMinutes;
  } else {
    minutes = 0;
  }
  return Math.min(Math.max(0, minutes), MAX_CREDITED_MINUTES);
}

/**
 * Records the attendance outcome for a shift and — for ATTENDED/PARTIAL —
 * generates a PENDING hour-entry ledger row using the precedence rules
 * above. NO_SHOW and EXCUSED never generate a ledger entry; mere signup
 * never has, and never will, generate one either.
 */
export async function setPtaVolunteerAttendanceStatus(
  organizationId: string,
  signupId: string,
  status: "ATTENDED" | "PARTIAL" | "NO_SHOW" | "EXCUSED",
  actorUserId: string,
  options: { manualMinutes?: number | null; notes?: string | null } = {},
  actorEmail?: string | null
) {
  const signup = await prisma.ptaVolunteerSignup.findFirst({ where: { id: signupId, organizationId }, include: { slot: true } });
  if (!signup) throw new PtaError("PTA_SIGNUP_NOT_FOUND", "Volunteer signup not found in this organization.");
  if (options.manualMinutes != null && (!Number.isInteger(options.manualMinutes) || options.manualMinutes < 0)) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Manually entered minutes must be a non-negative integer.");
  }

  const attendance = await getOrCreateAttendance(organizationId, signupId);

  const [, updatedSignup] = await prisma.$transaction([
    prisma.ptaVolunteerAttendance.update({
      where: { id: attendance.id },
      data: { status, recordedByUserId: actorUserId, officerNotes: options.notes ?? attendance.officerNotes },
    }),
    prisma.ptaVolunteerSignup.update({ where: { id: signupId }, data: { status } }),
  ]);

  let hourEntry = null;
  if (status === "ATTENDED" || status === "PARTIAL") {
    const creditedMinutes = computeCreditedMinutes({
      manualMinutes: options.manualMinutes,
      checkInAt: attendance.checkInAt,
      checkOutAt: attendance.checkOutAt,
      scheduledStart: signup.slot.startAt,
      scheduledEnd: signup.slot.endAt,
      defaultCreditedMinutes: signup.slot.defaultCreditedMinutes,
    });
    const schoolYear = (await prisma.ptaVolunteerOpportunity.findUnique({ where: { id: signup.slot.opportunityId }, select: { schoolYear: true } }))?.schoolYear ?? "unknown";

    hourEntry = await prisma.ptaVolunteerHourEntry.create({
      data: {
        organizationId,
        schoolYear,
        signupId,
        householdAdultId: signup.householdAdultId,
        householdId: signup.householdId,
        opportunityId: signup.slot.opportunityId,
        slotId: signup.slotId,
        creditedMinutes,
        status: "PENDING",
        // Self-reported hours (Phase 14) are deliberately out of scope this
        // pass — see docs/pta-volunteer-management.md — so every hour entry
        // generated by this function is officer-driven by definition.
        source: "OFFICER_MANUAL",
      },
    });
  }

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_attendance.status_set",
    entityType: "pta_volunteer_signup",
    entityId: signupId,
    metadata: { status, hourEntryId: hourEntry?.id ?? null, creditedMinutes: hourEntry?.creditedMinutes ?? null },
  });

  return { signup: updatedSignup, hourEntry };
}

// ─── Volunteer-hours ledger ─────────────────────────────────────────────────

export async function listPendingPtaVolunteerHourEntries(organizationId: string, filters: { schoolYear?: string; opportunityId?: string } = {}) {
  return prisma.ptaVolunteerHourEntry.findMany({
    where: { organizationId, status: "PENDING", ...(filters.schoolYear ? { schoolYear: filters.schoolYear } : {}), ...(filters.opportunityId ? { opportunityId: filters.opportunityId } : {}) },
    include: {
      signup: { include: { householdAdult: { select: { id: true, name: true } }, attendance: true, slot: { include: { opportunity: { select: { title: true } } } } } },
    },
    orderBy: { createdAt: "asc" },
  });
}

async function assertNotSelfApproval(organizationId: string, entry: { householdAdultId: string }, actorUserId: string) {
  const adult = await prisma.ptaHouseholdAdult.findFirst({ where: { id: entry.householdAdultId, organizationId }, select: { userId: true } });
  if (adult?.userId && adult.userId === actorUserId) {
    throw new PtaError("PTA_SELF_APPROVAL_FORBIDDEN", "You cannot approve your own volunteer hours — ask another authorized officer.");
  }
}

export async function approvePtaVolunteerHourEntry(organizationId: string, entryId: string, actorUserId: string, options: { adjustedMinutes?: number | null } = {}, actorEmail?: string | null) {
  const entry = await prisma.ptaVolunteerHourEntry.findFirst({ where: { id: entryId, organizationId } });
  if (!entry) throw new PtaError("PTA_HOUR_ENTRY_NOT_FOUND", "Volunteer hour entry not found in this organization.");
  if (entry.status !== "PENDING") throw new PtaError("PTA_HOUR_ENTRY_ALREADY_FINALIZED", `This hour entry is already ${entry.status.toLowerCase()}.`);
  await assertNotSelfApproval(organizationId, entry, actorUserId);
  if (options.adjustedMinutes != null && (!Number.isInteger(options.adjustedMinutes) || options.adjustedMinutes < 0)) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Adjusted minutes must be a non-negative integer.");
  }

  const updated = await prisma.ptaVolunteerHourEntry.update({
    where: { id: entryId },
    data: {
      status: "APPROVED",
      approvedByUserId: actorUserId,
      approvedAt: new Date(),
      ...(options.adjustedMinutes != null ? { creditedMinutes: options.adjustedMinutes } : {}),
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_hour_entry.approved",
    entityType: "pta_volunteer_hour_entry",
    entityId: entryId,
    metadata: { creditedMinutes: updated.creditedMinutes, adjustedAtApproval: options.adjustedMinutes != null },
  });

  return updated;
}

export async function rejectPtaVolunteerHourEntry(organizationId: string, entryId: string, reason: string, actorUserId: string, actorEmail?: string | null) {
  const entry = await prisma.ptaVolunteerHourEntry.findFirst({ where: { id: entryId, organizationId } });
  if (!entry) throw new PtaError("PTA_HOUR_ENTRY_NOT_FOUND", "Volunteer hour entry not found in this organization.");
  if (entry.status !== "PENDING") throw new PtaError("PTA_HOUR_ENTRY_ALREADY_FINALIZED", `This hour entry is already ${entry.status.toLowerCase()}.`);
  if (!reason.trim()) throw new PtaError("PTA_VALIDATION_ERROR", "A reason is required to reject an hour entry.");

  const updated = await prisma.ptaVolunteerHourEntry.update({
    where: { id: entryId },
    data: { status: "REJECTED", rejectedByUserId: actorUserId, rejectedAt: new Date(), notes: reason },
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_hour_entry.rejected",
    entityType: "pta_volunteer_hour_entry",
    entityId: entryId,
    metadata: { reason },
  });

  return updated;
}

/** Corrects an already-APPROVED entry via an immutable adjustment record (mirrors DuesAdjustment's pattern) rather than silently overwriting history. */
export async function adjustPtaVolunteerHourEntry(organizationId: string, entryId: string, minuteAdjustment: number, reason: string, actorUserId: string, actorEmail?: string | null) {
  const entry = await prisma.ptaVolunteerHourEntry.findFirst({ where: { id: entryId, organizationId } });
  if (!entry) throw new PtaError("PTA_HOUR_ENTRY_NOT_FOUND", "Volunteer hour entry not found in this organization.");
  if (entry.status !== "APPROVED") throw new PtaError("PTA_VALIDATION_ERROR", "Only an approved hour entry can be adjusted — reject a pending one instead.");
  if (!reason.trim()) throw new PtaError("PTA_VALIDATION_ERROR", "A reason is required to adjust an hour entry.");
  if (!Number.isInteger(minuteAdjustment)) throw new PtaError("PTA_VALIDATION_ERROR", "The adjustment must be a whole number of minutes.");

  const newTotal = Math.min(Math.max(0, entry.creditedMinutes + minuteAdjustment), MAX_CREDITED_MINUTES);

  const [updatedEntry] = await prisma.$transaction([
    prisma.ptaVolunteerHourEntry.update({ where: { id: entryId }, data: { creditedMinutes: newTotal } }),
    prisma.ptaVolunteerHourAdjustment.create({ data: { organizationId, hourEntryId: entryId, minuteAdjustment, reason, actorUserId } }),
  ]);

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_hour_entry.adjusted",
    entityType: "pta_volunteer_hour_entry",
    entityId: entryId,
    metadata: { minuteAdjustment, newTotal, reason },
  });

  return updatedEntry;
}

// ─── Totals & requirements ──────────────────────────────────────────────────

export interface PtaVolunteerHourTotals {
  approvedMinutes: number;
  pendingMinutes: number;
  requiredMinutes: number | null;
  remainingMinutes: number | null;
}

/** Derived strictly from APPROVED ledger entries — never from signups or attendance directly, so a cancelled or no-show shift can never inflate a total. */
export async function getPtaVolunteerHourTotalsForHousehold(organizationId: string, householdId: string, schoolYear: string): Promise<PtaVolunteerHourTotals> {
  const [approved, pending, requirement] = await Promise.all([
    prisma.ptaVolunteerHourEntry.aggregate({ where: { organizationId, householdId, schoolYear, status: "APPROVED" }, _sum: { creditedMinutes: true } }),
    prisma.ptaVolunteerHourEntry.aggregate({ where: { organizationId, householdId, schoolYear, status: "PENDING" }, _sum: { creditedMinutes: true } }),
    prisma.ptaVolunteerRequirement.findUnique({ where: { organizationId_schoolYear: { organizationId, schoolYear } } }),
  ]);

  const approvedMinutes = approved._sum.creditedMinutes ?? 0;
  const requiredMinutes = requirement?.active ? requirement.requiredMinutes : null;

  return {
    approvedMinutes,
    pendingMinutes: pending._sum.creditedMinutes ?? 0,
    requiredMinutes,
    remainingMinutes: requiredMinutes != null ? Math.max(0, requiredMinutes - approvedMinutes) : null,
  };
}

export async function upsertPtaVolunteerRequirement(organizationId: string, schoolYear: string, requiredMinutes: number, active: boolean, actorUserId: string, actorEmail?: string | null) {
  if (!Number.isInteger(requiredMinutes) || requiredMinutes < 0) throw new PtaError("PTA_VALIDATION_ERROR", "Required minutes must be a non-negative integer.");

  const requirement = await prisma.ptaVolunteerRequirement.upsert({
    where: { organizationId_schoolYear: { organizationId, schoolYear } },
    create: { organizationId, schoolYear, requiredMinutes, active },
    update: { requiredMinutes, active },
  });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.volunteer_requirement.updated",
    entityType: "pta_volunteer_requirement",
    entityId: requirement.id,
    metadata: { schoolYear, requiredMinutes, active },
  });

  return requirement;
}

export async function getPtaVolunteerRequirement(organizationId: string, schoolYear: string) {
  return prisma.ptaVolunteerRequirement.findUnique({ where: { organizationId_schoolYear: { organizationId, schoolYear } } });
}

// ─── Officer reports ────────────────────────────────────────────────────────

/** Household totals across every household with at least one dues-linked billing identity — used for "households with zero approved hours" and general reporting. */
export async function listPtaVolunteerHoursByHousehold(organizationId: string, schoolYear: string) {
  const households = await prisma.ptaHousehold.findMany({ where: { organizationId, schoolYear }, select: { id: true, displayName: true } });
  const totals = await prisma.ptaVolunteerHourEntry.groupBy({
    by: ["householdId", "status"],
    where: { organizationId, schoolYear, householdId: { not: null } },
    _sum: { creditedMinutes: true },
  });

  return households.map((h) => {
    const approved = totals.find((t) => t.householdId === h.id && t.status === "APPROVED")?._sum.creditedMinutes ?? 0;
    const pending = totals.find((t) => t.householdId === h.id && t.status === "PENDING")?._sum.creditedMinutes ?? 0;
    return { householdId: h.id, displayName: h.displayName, approvedMinutes: approved, pendingMinutes: pending };
  });
}

export async function listPtaVolunteerNoShows(organizationId: string, schoolYear?: string) {
  return prisma.ptaVolunteerSignup.findMany({
    where: { organizationId, status: "NO_SHOW", ...(schoolYear ? { slot: { opportunity: { schoolYear } } } : {}) },
    include: { householdAdult: { select: { name: true } }, slot: { include: { opportunity: { select: { title: true } } } } },
    orderBy: { updatedAt: "desc" },
  });
}

/** Shifts still below their informational minNeeded floor — purely a staffing-visibility report, never an enforced constraint. */
export async function listPtaUnderstaffedSlots(organizationId: string) {
  const slots = await prisma.ptaVolunteerSlot.findMany({
    where: { organizationId, minNeeded: { not: null }, opportunity: { status: { in: ["OPEN", "CLOSED"] } } },
    include: { opportunity: { select: { title: true, status: true } } },
  });
  return slots.filter((s) => s.minNeeded !== null && s.claimedCount < s.minNeeded);
}
