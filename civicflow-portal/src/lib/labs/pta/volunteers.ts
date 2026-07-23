import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";

/**
 * Volunteer opportunities, slots, and signups. Overbooking prevention is a
 * database-level atomic conditional UPDATE — the same pattern as
 * meeting-intelligence/worker.ts's claimQueuedJob() — not a
 * read-then-write application check, so it's actually race-safe under
 * concurrent signups, not just safe in the common case.
 */

export interface CreateOpportunityInput {
  organizationId: string;
  title: string;
  eventId?: string | null;
  description?: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
  signupDeadline?: Date | null;
  supplyRequest?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}

export async function createPtaVolunteerOpportunity(input: CreateOpportunityInput) {
  if (!input.title.trim()) throw new PtaError("PTA_VALIDATION_ERROR", "Opportunity title is required.");
  if (input.eventId) {
    const event = await prisma.event.findFirst({ where: { id: input.eventId, organizationId: input.organizationId } });
    if (!event) throw new PtaError("PTA_EVENT_NOT_FOUND", "Event not found in this organization.");
  }

  const opportunity = await prisma.ptaVolunteerOpportunity.create({
    data: {
      organizationId: input.organizationId,
      title: input.title,
      eventId: input.eventId ?? null,
      description: input.description ?? null,
      startAt: input.startAt ?? null,
      endAt: input.endAt ?? null,
      signupDeadline: input.signupDeadline ?? null,
      supplyRequest: input.supplyRequest ?? null,
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.volunteer_opportunity.created",
    entityType: "pta_volunteer_opportunity",
    entityId: opportunity.id,
    metadata: {},
  });

  return opportunity;
}

export async function addPtaVolunteerSlot(
  organizationId: string,
  opportunityId: string,
  input: { label?: string | null; startAt?: Date | null; endAt?: Date | null; capacity: number },
  actorUserId: string,
  actorEmail?: string | null
) {
  const opportunity = await prisma.ptaVolunteerOpportunity.findFirst({ where: { id: opportunityId, organizationId } });
  if (!opportunity) throw new PtaError("PTA_OPPORTUNITY_NOT_FOUND", "Volunteer opportunity not found in this organization.");
  if (!Number.isInteger(input.capacity) || input.capacity < 1) throw new PtaError("PTA_VALIDATION_ERROR", "Capacity must be a positive integer.");

  const slot = await prisma.ptaVolunteerSlot.create({
    data: { organizationId, opportunityId: opportunity.id, label: input.label ?? null, startAt: input.startAt ?? null, endAt: input.endAt ?? null, capacity: input.capacity },
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

export async function listPtaVolunteerOpportunities(organizationId: string, filters: { status?: string } = {}) {
  return prisma.ptaVolunteerOpportunity.findMany({
    where: { organizationId, ...(filters.status ? { status: filters.status as never } : {}) },
    include: {
      slots: {
        include: {
          signups: { where: { status: "SIGNED_UP" }, include: { householdAdult: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

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
  const slot = await prisma.ptaVolunteerSlot.findFirst({ where: { id: slotId, organizationId } });
  if (!slot) throw new PtaError("PTA_SLOT_NOT_FOUND", "Volunteer slot not found in this organization.");

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
      create: { organizationId, slotId, householdAdultId, status: "SIGNED_UP" },
      update: { status: "SIGNED_UP", cancelledAt: null, signedUpAt: new Date() },
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
 * Releases the claimed seat back to the slot — the mirror-image atomic
 * decrement of claimPtaVolunteerSlot(). Also wrapped in a transaction (same
 * hardening-review fix as the claim path) so a failure between the status
 * update and the decrement can never leave a signup CANCELLED while the
 * slot's claimedCount still reflects it as occupied.
 */
export async function cancelPtaVolunteerSignup(organizationId: string, slotId: string, householdAdultId: string, actorUserId: string, actorEmail?: string | null) {
  const signup = await prisma.ptaVolunteerSignup.findFirst({ where: { slotId, householdAdultId, organizationId } });
  if (!signup) throw new PtaError("PTA_SIGNUP_NOT_FOUND", "Volunteer signup not found in this organization.");
  if (signup.status !== "SIGNED_UP") return signup;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.ptaVolunteerSignup.update({ where: { id: signup.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
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
    metadata: { slotId },
  });

  return updated;
}

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
    include: { slot: { include: { opportunity: true } } },
    orderBy: { signedUpAt: "desc" },
  });
}
