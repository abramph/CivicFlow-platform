import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";

/**
 * PTA Vertical 2.0, PR PTA-A — board positions and officer history (see
 * docs/pta-vertical-2.md §2). Positions are org-configurable definitions;
 * PtaOfficerAssignment rows are the append-only "who held it, when" record.
 * The one invariant this module owns: assigning a new ACTIVE holder ENDs the
 * previous ACTIVE row (status + endDate) — it never deletes or rewrites it,
 * so "President: 2025-26 Person A, 2026-27 Person B" is always reconstructible.
 */

export interface StandardPosition {
  name: string;
  description: string;
  classification: "OFFICER" | "BOARD_MEMBER";
  isVoting: boolean;
  sortOrder: number;
}

/** Common PTA/PTO titles offered as one-click seeds — a convenience, never a
 * constraint. Orgs rename, deactivate, or add custom positions freely. */
export const STANDARD_POSITIONS: StandardPosition[] = [
  { name: "President", description: "Presides over meetings and represents the organization.", classification: "OFFICER", isVoting: true, sortOrder: 10 },
  { name: "Vice President", description: "Acts in the President's absence and supports major programs.", classification: "OFFICER", isVoting: true, sortOrder: 20 },
  { name: "Treasurer", description: "Maintains finances, budget, and financial reporting.", classification: "OFFICER", isVoting: true, sortOrder: 30 },
  { name: "Secretary", description: "Keeps minutes and official records of the organization.", classification: "OFFICER", isVoting: true, sortOrder: 40 },
  { name: "Membership Chair", description: "Leads membership drives and maintains the member roster.", classification: "OFFICER", isVoting: true, sortOrder: 50 },
  { name: "Fundraising Chair", description: "Plans and coordinates fundraising programs.", classification: "OFFICER", isVoting: true, sortOrder: 60 },
  { name: "Volunteer Coordinator", description: "Recruits and schedules volunteers.", classification: "OFFICER", isVoting: true, sortOrder: 70 },
  { name: "Parliamentarian", description: "Advises on bylaws and meeting procedure.", classification: "OFFICER", isVoting: false, sortOrder: 80 },
  { name: "Board Member", description: "At-large voting member of the board.", classification: "BOARD_MEMBER", isVoting: true, sortOrder: 90 },
];

export async function listBoardPositions(organizationId: string, options: { includeInactive?: boolean } = {}) {
  return prisma.ptaBoardPosition.findMany({
    where: { organizationId, ...(options.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/** The officer-facing roster: every active position with its current ACTIVE
 * holder (or none), display-named from the linked adult when present. */
export async function getBoardRoster(organizationId: string) {
  const positions = await prisma.ptaBoardPosition.findMany({
    where: { organizationId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      assignments: {
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { householdAdult: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  return positions.map((position) => {
    const active = position.assignments[0] ?? null;
    return {
      id: position.id,
      name: position.name,
      description: position.description,
      classification: position.classification,
      isVoting: position.isVoting,
      sortOrder: position.sortOrder,
      termLengthMonths: position.termLengthMonths,
      currentAssignment: active
        ? {
            id: active.id,
            holderName: active.householdAdult?.name ?? active.personName ?? "(unnamed)",
            householdAdultId: active.householdAdultId,
            schoolYearLabel: active.schoolYearLabel,
            startDate: active.startDate,
          }
        : null,
    };
  });
}

/** Full leadership history for one position, newest first — never trimmed. */
export async function getPositionHistory(organizationId: string, positionId: string) {
  const position = await prisma.ptaBoardPosition.findFirst({ where: { id: positionId, organizationId } });
  if (!position) throw new PtaError("PTA_BOARD_POSITION_NOT_FOUND", "Board position not found.");
  const assignments = await prisma.ptaOfficerAssignment.findMany({
    where: { organizationId, positionId },
    orderBy: [{ createdAt: "desc" }],
    include: { householdAdult: { select: { id: true, name: true } }, schoolYear: { select: { id: true, label: true } } },
  });
  return { position, assignments };
}

export interface CreateBoardPositionInput {
  organizationId: string;
  name: string;
  description?: string | null;
  responsibilities?: string | null;
  classification?: "OFFICER" | "BOARD_MEMBER";
  isVoting?: boolean;
  sortOrder?: number;
  termLengthMonths?: number | null;
  actorUserId: string;
  actorEmail?: string | null;
}

export async function createBoardPosition(input: CreateBoardPositionInput) {
  const name = input.name.trim();
  if (!name) throw new PtaError("PTA_VALIDATION_ERROR", "Position name is required.");
  const existing = await prisma.ptaBoardPosition.findUnique({
    where: { organizationId_name: { organizationId: input.organizationId, name } },
  });
  if (existing) throw new PtaError("PTA_VALIDATION_ERROR", `A position named "${name}" already exists.`);

  const position = await prisma.ptaBoardPosition.create({
    data: {
      organizationId: input.organizationId,
      name,
      description: input.description ?? null,
      responsibilities: input.responsibilities ?? null,
      classification: input.classification ?? "OFFICER",
      isVoting: input.isVoting ?? true,
      sortOrder: input.sortOrder ?? 0,
      termLengthMonths: input.termLengthMonths ?? null,
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.board.position_created",
    entityType: "pta_board_position",
    entityId: position.id,
    metadata: { name: position.name, classification: position.classification },
  });
  return position;
}

export interface UpdateBoardPositionInput {
  organizationId: string;
  positionId: string;
  name?: string;
  description?: string | null;
  responsibilities?: string | null;
  classification?: "OFFICER" | "BOARD_MEMBER";
  isVoting?: boolean;
  sortOrder?: number;
  termLengthMonths?: number | null;
  /** Deactivation retires a position from pickers; history stays intact.
   * There is deliberately no hard delete in this module. */
  isActive?: boolean;
  actorUserId: string;
  actorEmail?: string | null;
}

export async function updateBoardPosition(input: UpdateBoardPositionInput) {
  const existing = await prisma.ptaBoardPosition.findFirst({
    where: { id: input.positionId, organizationId: input.organizationId },
  });
  if (!existing) throw new PtaError("PTA_BOARD_POSITION_NOT_FOUND", "Board position not found.");

  const name = input.name?.trim();
  if (name !== undefined && !name) throw new PtaError("PTA_VALIDATION_ERROR", "Position name cannot be blank.");

  const position = await prisma.ptaBoardPosition.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.responsibilities !== undefined ? { responsibilities: input.responsibilities } : {}),
      ...(input.classification !== undefined ? { classification: input.classification } : {}),
      ...(input.isVoting !== undefined ? { isVoting: input.isVoting } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.termLengthMonths !== undefined ? { termLengthMonths: input.termLengthMonths } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.board.position_updated",
    entityType: "pta_board_position",
    entityId: position.id,
    metadata: { before: { name: existing.name, isActive: existing.isActive }, after: { name: position.name, isActive: position.isActive } },
  });
  return position;
}

/** One-click seeding of STANDARD_POSITIONS — an explicit officer action (never
 * automatic on org creation), idempotent via skipDuplicates on (org, name). */
export async function seedStandardPositions(input: { organizationId: string; actorUserId: string; actorEmail?: string | null }) {
  const result = await prisma.ptaBoardPosition.createMany({
    data: STANDARD_POSITIONS.map((position) => ({
      organizationId: input.organizationId,
      name: position.name,
      description: position.description,
      classification: position.classification,
      isVoting: position.isVoting,
      sortOrder: position.sortOrder,
    })),
    skipDuplicates: true,
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.board.standard_positions_seeded",
    entityType: "pta_board_position",
    entityId: input.organizationId,
    metadata: { created: result.count },
  });
  return result;
}

export interface AssignOfficerInput {
  organizationId: string;
  positionId: string;
  /** Preferred holder identity — a linked household adult in this org. */
  householdAdultId?: string | null;
  /** Fallback for holders with no adult record (e.g. historical boards). */
  personName?: string | null;
  schoolYearId?: string | null;
  status?: "ACTIVE" | "INCOMING";
  startDate?: Date | null;
  notes?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}

/**
 * Records a holder for a position. ACTIVE assignment transactionally ENDs any
 * existing ACTIVE rows for the same position (endDate = new start, never
 * deleted). INCOMING rows (next year's board, prepared ahead) coexist with
 * the sitting officer untouched until activation.
 */
export async function assignOfficer(input: AssignOfficerInput) {
  const position = await prisma.ptaBoardPosition.findFirst({
    where: { id: input.positionId, organizationId: input.organizationId },
  });
  if (!position) throw new PtaError("PTA_BOARD_POSITION_NOT_FOUND", "Board position not found.");

  const personName = input.personName?.trim() || null;
  if (!input.householdAdultId && !personName) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Provide either a household adult or a name for the officer.");
  }

  let holderName = personName;
  if (input.householdAdultId) {
    const adult = await prisma.ptaHouseholdAdult.findFirst({
      where: { id: input.householdAdultId, organizationId: input.organizationId },
    });
    if (!adult) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household adult not found in this organization.");
    holderName = adult.name;
  }

  let schoolYearLabel: string | null = null;
  if (input.schoolYearId) {
    const year = await prisma.ptaSchoolYear.findFirst({
      where: { id: input.schoolYearId, organizationId: input.organizationId },
    });
    if (!year) throw new PtaError("PTA_SCHOOL_YEAR_NOT_FOUND", "School year not found.");
    schoolYearLabel = year.label;
  } else {
    const profile = await prisma.ptaProfile.findUnique({ where: { organizationId: input.organizationId } });
    schoolYearLabel = profile?.currentSchoolYear ?? null;
  }

  const status = input.status ?? "ACTIVE";
  const startDate = input.startDate ?? (status === "ACTIVE" ? new Date() : null);

  const assignment = await prisma.$transaction(async (tx) => {
    if (status === "ACTIVE") {
      await tx.ptaOfficerAssignment.updateMany({
        where: { organizationId: input.organizationId, positionId: position.id, status: "ACTIVE" },
        data: { status: "ENDED", endDate: startDate ?? new Date() },
      });
    }
    return tx.ptaOfficerAssignment.create({
      data: {
        organizationId: input.organizationId,
        positionId: position.id,
        householdAdultId: input.householdAdultId ?? null,
        personName,
        schoolYearId: input.schoolYearId ?? null,
        schoolYearLabel,
        status,
        startDate,
        notes: input.notes ?? null,
        createdByUserId: input.actorUserId,
      },
    });
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.board.officer_assigned",
    entityType: "pta_officer_assignment",
    entityId: assignment.id,
    metadata: { position: position.name, holder: holderName, status, schoolYear: schoolYearLabel },
  });
  return assignment;
}

export interface EndOfficerAssignmentInput {
  organizationId: string;
  assignmentId: string;
  endDate?: Date | null;
  actorUserId: string;
  actorEmail?: string | null;
}

/** Ends a term without a successor (resignation, vacancy). Idempotent-ish:
 * ending an already-ENDED row is rejected rather than silently rewritten. */
export async function endOfficerAssignment(input: EndOfficerAssignmentInput) {
  const existing = await prisma.ptaOfficerAssignment.findFirst({
    where: { id: input.assignmentId, organizationId: input.organizationId },
    include: { position: { select: { name: true } } },
  });
  if (!existing) throw new PtaError("PTA_OFFICER_ASSIGNMENT_NOT_FOUND", "Officer assignment not found.");
  if (existing.status === "ENDED") throw new PtaError("PTA_VALIDATION_ERROR", "This assignment has already ended.");

  const assignment = await prisma.ptaOfficerAssignment.update({
    where: { id: existing.id },
    data: { status: "ENDED", endDate: input.endDate ?? new Date() },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.board.assignment_ended",
    entityType: "pta_officer_assignment",
    entityId: assignment.id,
    metadata: { position: existing.position.name },
  });
  return assignment;
}

/** Promotes an INCOMING assignment to ACTIVE (the "takes office" moment) —
 * ends the sitting ACTIVE holder exactly like assignOfficer does. */
export async function activateOfficerAssignment(input: EndOfficerAssignmentInput) {
  const existing = await prisma.ptaOfficerAssignment.findFirst({
    where: { id: input.assignmentId, organizationId: input.organizationId },
    include: { position: { select: { id: true, name: true } } },
  });
  if (!existing) throw new PtaError("PTA_OFFICER_ASSIGNMENT_NOT_FOUND", "Officer assignment not found.");
  if (existing.status !== "INCOMING") throw new PtaError("PTA_VALIDATION_ERROR", "Only an incoming assignment can be activated.");

  const startDate = input.endDate ?? new Date();
  const assignment = await prisma.$transaction(async (tx) => {
    await tx.ptaOfficerAssignment.updateMany({
      where: { organizationId: input.organizationId, positionId: existing.position.id, status: "ACTIVE" },
      data: { status: "ENDED", endDate: startDate },
    });
    return tx.ptaOfficerAssignment.update({
      where: { id: existing.id },
      data: { status: "ACTIVE", startDate: existing.startDate ?? startDate },
    });
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.board.assignment_activated",
    entityType: "pta_officer_assignment",
    entityId: assignment.id,
    metadata: { position: existing.position.name },
  });
  return assignment;
}
