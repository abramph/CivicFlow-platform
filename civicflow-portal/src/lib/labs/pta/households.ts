import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";

/**
 * Household/family membership — the primary PTA membership entity. Every
 * function takes organizationId as an explicit required parameter and scopes
 * every Prisma query by it (tenant isolation), mirroring meeting-intelligence's
 * jobs.ts convention.
 *
 * `orgMemberId` is the household's "billing identity": a normal OrgMember row
 * created so dues can run through the existing, unmodified dues/payments
 * pipeline (see dues.ts). It never carries a login of its own — its email
 * mirrors the primary contact adult's, and updating the primary contact
 * updates this row too (see setPrimaryContact()).
 */

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

export async function listPtaHouseholds(organizationId: string, filters: { schoolYear?: string; status?: string } = {}) {
  return prisma.ptaHousehold.findMany({
    where: {
      organizationId,
      ...(filters.schoolYear ? { schoolYear: filters.schoolYear } : {}),
      ...(filters.status ? { status: filters.status as never } : {}),
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
    if (household.orgMemberId && (input.email || input.phone)) {
      await prisma.orgMember.update({
        where: { id: household.orgMemberId },
        data: { email: input.email ?? undefined, phone: input.phone ?? undefined },
      });
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
