import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";
import { resolveSchoolYearId } from "./school-years";

/**
 * Household/family membership — the primary PTA membership entity. Every
 * function takes organizationId as an explicit required parameter and scopes
 * every Prisma query by it (tenant isolation), mirroring meeting-intelligence's
 * jobs.ts convention.
 *
 * `orgMemberId` is the household's "billing identity": a normal OrgMember row
 * created so dues can run through the existing, unmodified dues/payments
 * pipeline (see dues.ts). It never carries a login of its own.
 *
 * Two independent sync rules keep it from drifting out of agreement with
 * the household it represents (full rationale in
 * docs/pta-communication-identity.md):
 *   - email/phone: filled in ONCE, never overwritten (syncHouseholdBillingContact) —
 *     a "preserve any real value, whether synced or manually edited" rule.
 *   - membershipStatus: always kept in lockstep with PtaHousehold.status
 *     (syncHouseholdMembershipStatus) — an "authoritative, unconditional"
 *     rule, not a preference: the OrgMember only exists to represent this
 *     household, so there's no competing manual edit to protect.
 */

/**
 * Fills the billing-identity OrgMember's email/phone from a household's
 * primary contact adult — but only fields that are currently empty. Never
 * overwrites a non-empty value, whether it was set by a prior sync or a
 * deliberate manual edit via the general member-edit form (updateMember() in
 * member-mutations.ts, which every OrgMember — including this one — can be
 * edited through). This is what actually preserves a manual override: there
 * is no separate "manually set" flag, emptiness itself is the "not yet set"
 * signal, so a real edit is indistinguishable from (and therefore safe from)
 * a later sync attempt.
 */
async function syncHouseholdBillingContact(orgMemberId: string, email: string | null, phone: string | null) {
  const member = await prisma.orgMember.findUnique({ where: { id: orgMemberId }, select: { email: true, phone: true } });
  if (!member) return;

  const data: { email?: string; phone?: string } = {};
  if (!member.email && email) data.email = email;
  if (!member.phone && phone) data.phone = phone;
  if (Object.keys(data).length > 0) {
    await prisma.orgMember.update({ where: { id: orgMemberId }, data });
  }
}

/**
 * Unlike email/phone (fill-once, never overwrite — see
 * syncHouseholdBillingContact above), a household's active/inactive state
 * always propagates to its billing OrgMember unconditionally. This isn't a
 * "preserve a manual edit" situation: PtaHousehold.status is authoritative
 * over its own billing identity's lifecycle by construction (the OrgMember
 * only exists to represent this household in the first place), so there is
 * no competing manual edit to protect against.
 *
 * Without this, deactivating a household left its billing OrgMember's own
 * membershipStatus untouched (still "active", the create-time default) —
 * invisible to the PTA-specific targeting rules (which correctly query
 * PtaHousehold.status directly), but a real, silent leak on the base
 * platform selectors ("All active with email", "Delinquent members",
 * "By category/location") that every PTA organization can also see and
 * use, and which filter on OrgMember.membershipStatus instead.
 */
async function syncHouseholdMembershipStatus(orgMemberId: string, householdStatus: "ACTIVE" | "INACTIVE" | "PENDING") {
  const membershipStatus = householdStatus === "ACTIVE" ? "active" : householdStatus === "PENDING" ? "pending" : "inactive";
  await prisma.orgMember.update({ where: { id: orgMemberId }, data: { membershipStatus } });
}

export interface CreateHouseholdInput {
  organizationId: string;
  displayName: string;
  schoolYear: string;
  status?: "ACTIVE" | "INACTIVE" | "PENDING";
  volunteerInterests?: string[];
  notes?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}

export async function createPtaHousehold(input: CreateHouseholdInput) {
  if (!input.displayName.trim()) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Household display name is required.");
  }

  // The billing-identity OrgMember is created eagerly so dues wiring "just
  // works" from the moment a household exists — see dues.ts. It carries only
  // the household display name; no student data is ever placed on it.
  const orgMember = await prisma.orgMember.create({
    data: {
      organizationId: input.organizationId,
      firstName: input.displayName,
      lastName: "(PTA Household)",
      householdName: input.displayName,
    },
  });

  const household = await prisma.ptaHousehold.create({
    data: {
      organizationId: input.organizationId,
      displayName: input.displayName,
      schoolYear: input.schoolYear,
      schoolYearId: await resolveSchoolYearId(input.organizationId, input.schoolYear),
      status: input.status ?? "ACTIVE",
      volunteerInterests: input.volunteerInterests ?? [],
      notes: input.notes ?? null,
      orgMemberId: orgMember.id,
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.household.created",
    entityType: "pta_household",
    entityId: household.id,
    metadata: { schoolYear: input.schoolYear },
  });

  return household;
}

export async function getPtaHousehold(organizationId: string, householdId: string) {
  const household = await prisma.ptaHousehold.findFirst({
    where: { id: householdId, organizationId },
    include: { adults: true, students: true },
  });
  if (!household) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");
  return household;
}

/**
 * Resolves which User accounts should receive a push notification addressed
 * to a PTA household's billing-identity OrgMember. That OrgMember never
 * carries a personal login of its own (see the module doc above), so
 * sendPushToMember()'s normal "look up this member's own userId" resolution
 * always comes back empty for a household — this is the fallback it calls
 * instead, resolving through every adult actually linked to the household.
 * Only an ACTIVE household's adults are returned: a deactivated household
 * loses push access at the same moment it loses in-app access (see
 * requireMobilePtaHouseholdAccess), not just when its lead contact happens
 * to be removed.
 */
export async function resolvePtaHouseholdAdultUserIds(organizationId: string, orgMemberId: string): Promise<string[]> {
  const household = await prisma.ptaHousehold.findFirst({
    where: { organizationId, orgMemberId, status: "ACTIVE" },
    select: { adults: { where: { userId: { not: null } }, select: { userId: true } } },
  });
  if (!household) return [];
  return household.adults.map((adult) => adult.userId).filter((userId): userId is string => userId != null);
}

/**
 * Batched sibling of resolvePtaHouseholdAdultUserIds() for a set of
 * billing-identity OrgMember ids at once — one query instead of N, for a
 * bulk communication campaign's recipient list (see
 * communication-campaigns.ts's processRecipient(), which otherwise only
 * ever checked a recipient's own OrgMember.userId directly and silently
 * sent zero push notifications for every PTA household recipient, since a
 * household billing identity never has a personal login of its own).
 */
export async function resolvePtaHouseholdAdultUserIdsBatch(organizationId: string, orgMemberIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (orgMemberIds.length === 0) return result;

  const households = await prisma.ptaHousehold.findMany({
    where: { organizationId, orgMemberId: { in: orgMemberIds }, status: "ACTIVE" },
    select: { orgMemberId: true, adults: { where: { userId: { not: null } }, select: { userId: true } } },
  });

  for (const household of households) {
    if (!household.orgMemberId) continue;
    const userIds = household.adults.map((adult) => adult.userId).filter((userId): userId is string => userId != null);
    if (userIds.length > 0) result.set(household.orgMemberId, userIds);
  }

  return result;
}

export async function listPtaHouseholds(organizationId: string, filters: { schoolYear?: string; status?: string; search?: string } = {}) {
  return prisma.ptaHousehold.findMany({
    where: {
      organizationId,
      ...(filters.schoolYear ? { schoolYear: filters.schoolYear } : {}),
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.search
        ? {
            OR: [
              { displayName: { contains: filters.search, mode: "insensitive" } },
              { adults: { some: { name: { contains: filters.search, mode: "insensitive" } } } },
              { students: { some: { displayName: { contains: filters.search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: { adults: true, students: { select: { id: true, displayName: true, status: true } } },
    orderBy: { displayName: "asc" },
  });
}

export interface UpdateHouseholdInput {
  organizationId: string;
  householdId: string;
  displayName?: string;
  status?: "ACTIVE" | "INACTIVE" | "PENDING";
  volunteerInterests?: string[];
  notes?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}

export async function updatePtaHousehold(input: UpdateHouseholdInput) {
  const existing = await prisma.ptaHousehold.findFirst({ where: { id: input.householdId, organizationId: input.organizationId } });
  if (!existing) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");

  const updated = await prisma.ptaHousehold.update({
    where: { id: existing.id },
    data: {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.volunteerInterests !== undefined ? { volunteerInterests: input.volunteerInterests } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });

  if (input.status !== undefined && input.status !== existing.status && existing.orgMemberId) {
    await syncHouseholdMembershipStatus(existing.orgMemberId, input.status);
  }

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.household.updated",
    entityType: "pta_household",
    entityId: existing.id,
    metadata: { fields: Object.keys(input).filter((k) => !["organizationId", "householdId", "actorUserId", "actorEmail"].includes(k)) },
  });

  return updated;
}

/**
 * Deactivates a household (soft delete) — the safe default whenever any dues
 * history could exist. A hard delete is only permitted when the linked
 * billing-identity OrgMember has never had a DuesCharge (no payment history
 * to lose); see deletePtaHousehold(). Either way, the billing-identity
 * OrgMember and any DuesCharge/DuesPayment rows are NEVER deleted by this
 * function (the FK is onDelete: SetNull, not Cascade) — financial history
 * always survives a household being deactivated or removed.
 */
export async function deactivatePtaHousehold(organizationId: string, householdId: string, actorUserId: string, actorEmail?: string | null) {
  const existing = await prisma.ptaHousehold.findFirst({ where: { id: householdId, organizationId } });
  if (!existing) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");

  const updated = await prisma.ptaHousehold.update({ where: { id: existing.id }, data: { status: "INACTIVE" } });

  if (existing.orgMemberId) {
    await syncHouseholdMembershipStatus(existing.orgMemberId, "INACTIVE");
  }

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.household.deactivated",
    entityType: "pta_household",
    entityId: existing.id,
    metadata: {},
  });

  return updated;
}

/** Hard delete — only permitted when the household's billing-identity OrgMember has zero DuesCharge rows (no financial history to lose). */
export async function deletePtaHousehold(organizationId: string, householdId: string, actorUserId: string, actorEmail?: string | null) {
  const existing = await prisma.ptaHousehold.findFirst({ where: { id: householdId, organizationId } });
  if (!existing) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");

  if (existing.orgMemberId) {
    const chargeCount = await prisma.duesCharge.count({ where: { organizationId, memberId: existing.orgMemberId } });
    if (chargeCount > 0) {
      throw new PtaError("PTA_HOUSEHOLD_HAS_PAYMENT_HISTORY", "This household has dues payment history — deactivate it instead of deleting it.");
    }
  }

  // feature/pta-family-agreement-buyout follow-up (FA2 §7, hardened FA3
  // §1/§2/§5): agreement acceptances, buyout elections, buyout purchases,
  // assessment charges, and hour disputes are all historical/financial
  // records and must never be lost merely because a household record is
  // removed. As of the FA3 retention-hardening migration, all five of
  // these models' householdId FKs are database-level ON DELETE RESTRICT —
  // so a hard delete against a household with any of this history is
  // ALREADY unreachable regardless of this guard (Postgres itself would
  // reject the DELETE with a raw foreign-key-violation error). This
  // pre-check exists purely to surface that as a friendly, typed PtaError
  // instead of a raw constraint-violation error bubbling out of Prisma —
  // defense in depth alongside the DB constraint, not the only thing
  // preventing the loss, mirroring the DuesCharge check immediately above.
  const [agreementAcceptanceCount, buyoutElectionCount, buyoutPurchaseCount, assessmentChargeCount, hourDisputeCount] = await Promise.all([
    prisma.ptaVolunteerAgreementAcceptance.count({ where: { organizationId, householdId } }),
    prisma.ptaVolunteerBuyoutElection.count({ where: { organizationId, householdId } }),
    prisma.ptaVolunteerBuyoutPurchase.count({ where: { organizationId, householdId } }),
    prisma.ptaVolunteerAssessmentCharge.count({ where: { organizationId, householdId } }),
    prisma.ptaVolunteerHourDispute.count({ where: { organizationId, householdId } }),
  ]);
  if (agreementAcceptanceCount > 0) {
    throw new PtaError(
      "PTA_HOUSEHOLD_HAS_AGREEMENT_HISTORY",
      "This household has volunteer agreement acceptance history — deactivate it instead of deleting it."
    );
  }
  if (buyoutElectionCount > 0 || buyoutPurchaseCount > 0 || assessmentChargeCount > 0 || hourDisputeCount > 0) {
    throw new PtaError(
      "PTA_HOUSEHOLD_HAS_VOLUNTEER_FINANCIAL_HISTORY",
      "This household has volunteer buyout, assessment, or dispute history — deactivate it instead of deleting it."
    );
  }

  await prisma.ptaHousehold.delete({ where: { id: existing.id } });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.household.deleted",
    entityType: "pta_household",
    entityId: existing.id,
    metadata: {},
  });
}

// ─── Household adults ──────────────────────────────────────────────────────

export interface AddHouseholdAdultInput {
  organizationId: string;
  householdId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  relationshipLabel?: string | null;
  userId?: string | null;
  makePrimaryContact?: boolean;
  actorUserId: string;
  actorEmail?: string | null;
}

export async function addPtaHouseholdAdult(input: AddHouseholdAdultInput) {
  const household = await prisma.ptaHousehold.findFirst({ where: { id: input.householdId, organizationId: input.organizationId } });
  if (!household) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");
  if (!input.name.trim()) throw new PtaError("PTA_VALIDATION_ERROR", "Adult name is required.");

  const adult = await prisma.ptaHouseholdAdult.create({
    data: {
      organizationId: input.organizationId,
      householdId: household.id,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      relationshipLabel: input.relationshipLabel ?? null,
      userId: input.userId ?? null,
    },
  });

  if (input.makePrimaryContact) {
    await prisma.ptaHousehold.update({ where: { id: household.id }, data: { primaryContactAdultId: adult.id } });
    if (household.orgMemberId) {
      await syncHouseholdBillingContact(household.orgMemberId, input.email ?? null, input.phone ?? null);
    }
  }

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.household_adult.added",
    entityType: "pta_household",
    entityId: household.id,
    metadata: { adultId: adult.id },
  });

  return adult;
}

/**
 * Designates (or reassigns) a household's primary contact after it already
 * exists — the function the module's own original doc comment always
 * claimed existed ("see setPrimaryContact()") but that, until now, was never
 * actually built: addPtaHouseholdAdult()'s makePrimaryContact flag only ever
 * covered the moment an adult is first added, with no way to designate one
 * later (e.g. for a household created before this existed, or to hand off
 * primary-contact status to a second adult). Fixes the real production gap
 * found via the PR #79 smoke test: the officer web UI's "Add adult" form
 * never sent makePrimaryContact at all, so any household built through it
 * (as opposed to CSV import, which always sets it) got a billing OrgMember
 * with no email — silently invisible to every EMAIL-channel communication
 * selector, PTA-specific or not.
 */
export async function setPtaHouseholdPrimaryContact(organizationId: string, householdId: string, adultId: string, actorUserId: string, actorEmail?: string | null) {
  const household = await prisma.ptaHousehold.findFirst({ where: { id: householdId, organizationId } });
  if (!household) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");

  const adult = await prisma.ptaHouseholdAdult.findFirst({ where: { id: adultId, householdId, organizationId } });
  if (!adult) throw new PtaError("PTA_NOT_A_HOUSEHOLD_MEMBER", "Household adult not found in this organization.");

  const updated = await prisma.ptaHousehold.update({ where: { id: household.id }, data: { primaryContactAdultId: adult.id } });

  if (household.orgMemberId) {
    await syncHouseholdBillingContact(household.orgMemberId, adult.email, adult.phone);
  }

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.household.primary_contact_set",
    entityType: "pta_household",
    entityId: household.id,
    metadata: { adultId },
  });

  return updated;
}

export async function removePtaHouseholdAdult(organizationId: string, householdId: string, adultId: string, actorUserId: string, actorEmail?: string | null) {
  const adult = await prisma.ptaHouseholdAdult.findFirst({ where: { id: adultId, householdId, organizationId } });
  if (!adult) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household adult not found in this organization.");

  await prisma.ptaHouseholdAdult.delete({ where: { id: adult.id } });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.household_adult.removed",
    entityType: "pta_household",
    entityId: householdId,
    metadata: { adultId },
  });
}

// ─── Students ───────────────────────────────────────────────────────────────

export interface AddStudentInput {
  organizationId: string;
  householdId: string;
  displayName: string;
  actorUserId: string;
  actorEmail?: string | null;
}

/**
 * Deliberately minimal — see the PtaStudent model's doc comment for the full
 * list of fields never collected here. `entityId` in the audit event is the
 * only student-related value ever recorded — never displayName, never any
 * other field.
 */
export async function addPtaStudent(input: AddStudentInput) {
  const household = await prisma.ptaHousehold.findFirst({ where: { id: input.householdId, organizationId: input.organizationId } });
  if (!household) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");
  if (!input.displayName.trim()) throw new PtaError("PTA_VALIDATION_ERROR", "Student display name is required.");

  const student = await prisma.ptaStudent.create({
    data: { organizationId: input.organizationId, householdId: household.id, displayName: input.displayName },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.student.added",
    entityType: "pta_student",
    entityId: student.id,
    metadata: {},
  });

  return student;
}

export async function deactivatePtaStudent(organizationId: string, householdId: string, studentId: string, actorUserId: string, actorEmail?: string | null) {
  const student = await prisma.ptaStudent.findFirst({ where: { id: studentId, householdId, organizationId } });
  if (!student) throw new PtaError("PTA_STUDENT_NOT_FOUND", "Student not found in this organization.");

  const updated = await prisma.ptaStudent.update({ where: { id: student.id }, data: { status: "INACTIVE" } });

  await createAuditEvent({
    organizationId,
    actorUserId,
    actorEmail: actorEmail ?? null,
    action: "pta.student.deactivated",
    entityType: "pta_student",
    entityId: student.id,
    metadata: {},
  });

  return updated;
}
