import type { PtaVolunteerAssignmentType, PtaVolunteerScopeType } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { PtaError } from "../errors";
import { getVolunteerRequirementPeriod } from "./periods";

export interface AssignmentInput {
  scopeType: PtaVolunteerScopeType;
  scopeRefId?: string | null;
  householdId?: string | null;
  assignmentType: PtaVolunteerAssignmentType;
  requiredMinutesOverride?: number | null;
  reason?: string | null;
  exemptUntil?: Date | null;
}

function validateAssignmentInput(input: AssignmentInput) {
  if (input.scopeType === "HOUSEHOLD" || input.scopeType === "PROGRAM") {
    if (!input.householdId) {
      throw new PtaError("PTA_VALIDATION_ERROR", "A household-level or program assignment needs a household.");
    }
  } else if (input.householdId) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Only HOUSEHOLD and PROGRAM assignments may target a specific household.");
  }
  if (input.scopeType === "PROGRAM" && !input.scopeRefId?.trim()) {
    throw new PtaError("PTA_VALIDATION_ERROR", "A program assignment needs a program label.");
  }
  if ((input.scopeType === "GRADE" || input.scopeType === "CLASSROOM" || input.scopeType === "MEMBERSHIP_PLAN") && !input.scopeRefId) {
    throw new PtaError("PTA_VALIDATION_ERROR", "This scope type needs a scopeRefId (grade, classroom, or membership category id).");
  }

  if (input.assignmentType !== "STANDARD" && !input.reason?.trim()) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Every non-standard assignment (custom, reduced, exempt, or waived) needs a reason.");
  }
  if ((input.assignmentType === "CUSTOM" || input.assignmentType === "REDUCED") && input.requiredMinutesOverride == null) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Custom and reduced assignments need an explicit required-hours figure.");
  }
  if (input.requiredMinutesOverride != null && (!Number.isInteger(input.requiredMinutesOverride) || input.requiredMinutesOverride < 0)) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Required hours must be a non-negative whole number of minutes.");
  }
  if (input.assignmentType === "EXEMPT_TEMPORARY" && !input.exemptUntil) {
    throw new PtaError("PTA_VALIDATION_ERROR", "A temporary exemption needs an end date.");
  }
}

export async function listPeriodAssignments(organizationId: string, periodId: string) {
  await getVolunteerRequirementPeriod(organizationId, periodId); // 404s on cross-org/missing period
  return prisma.ptaVolunteerRequirementAssignment.findMany({
    where: { organizationId, periodId },
    orderBy: [{ scopeType: "asc" }, { createdAt: "desc" }],
  });
}

export async function createAssignment(
  organizationId: string,
  periodId: string,
  input: AssignmentInput,
  actor: { userId: string; userEmail?: string | null }
) {
  await getVolunteerRequirementPeriod(organizationId, periodId);
  validateAssignmentInput(input);

  if (input.householdId) {
    const household = await prisma.ptaHousehold.findFirst({ where: { id: input.householdId, organizationId }, select: { id: true } });
    if (!household) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");
  }

  const assignment = await prisma.ptaVolunteerRequirementAssignment.create({
    data: {
      organizationId,
      periodId,
      scopeType: input.scopeType,
      scopeRefId: input.scopeRefId?.trim() || null,
      householdId: input.householdId ?? null,
      assignmentType: input.assignmentType,
      requiredMinutesOverride: input.requiredMinutesOverride ?? null,
      reason: input.reason?.trim() || null,
      exemptUntil: input.exemptUntil ?? null,
      createdByUserId: actor.userId,
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.assignment_created",
    entityType: "pta_volunteer_requirement_assignment",
    entityId: assignment.id,
    metadata: {
      periodId,
      scopeType: assignment.scopeType,
      assignmentType: assignment.assignmentType,
      householdId: assignment.householdId,
      reason: assignment.reason,
    },
  });

  return assignment;
}

export async function deleteAssignment(organizationId: string, assignmentId: string, actor: { userId: string; userEmail?: string | null }) {
  const existing = await prisma.ptaVolunteerRequirementAssignment.findFirst({ where: { id: assignmentId, organizationId } });
  if (!existing) throw new PtaError("PTA_VALIDATION_ERROR", "Assignment not found in this organization.");

  await prisma.ptaVolunteerRequirementAssignment.delete({ where: { id: assignmentId } });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.assignment_deleted",
    entityType: "pta_volunteer_requirement_assignment",
    entityId: assignmentId,
    metadata: {
      periodId: existing.periodId,
      scopeType: existing.scopeType,
      assignmentType: existing.assignmentType,
      householdId: existing.householdId,
      reason: existing.reason,
    },
  });
}

// ─── Resolution ──────────────────────────────────────────────────────────

export interface HouseholdRequirementResult {
  requiredMinutes: number;
  assignmentType: PtaVolunteerAssignmentType;
  matchedScopeType: PtaVolunteerScopeType | null;
  assignmentId: string | null;
  reason: string | null;
  exempt: boolean;
}

interface HouseholdScopeContext {
  householdId: string;
  currentClassroomIds: string[];
  currentGradeIds: string[];
  membershipCategoryId: string | null;
  enrolledChildCount: number;
  adultCount: number;
}

async function getHouseholdScopeContext(organizationId: string, householdId: string): Promise<HouseholdScopeContext> {
  const [currentYear, students, adultCount, household] = await Promise.all([
    prisma.ptaSchoolYear.findFirst({ where: { organizationId, isCurrent: true }, select: { id: true } }),
    prisma.ptaStudent.findMany({ where: { organizationId, householdId }, select: { id: true } }),
    prisma.ptaHouseholdAdult.count({ where: { organizationId, householdId } }),
    prisma.ptaHousehold.findUnique({ where: { id: householdId }, select: { orgMemberId: true } }),
  ]);

  const studentIds = students.map((s) => s.id);
  let currentClassroomIds: string[] = [];
  let currentGradeIds: string[] = [];
  if (currentYear && studentIds.length > 0) {
    const enrollments = await prisma.ptaStudentEnrollment.findMany({
      where: { organizationId, studentId: { in: studentIds }, schoolYearId: currentYear.id, status: "ACTIVE" },
      select: { classroomId: true, classroom: { select: { gradeId: true } } },
    });
    currentClassroomIds = [...new Set(enrollments.map((e) => e.classroomId))];
    currentGradeIds = [...new Set(enrollments.map((e) => e.classroom.gradeId))];
  }

  let membershipCategoryId: string | null = null;
  if (household?.orgMemberId) {
    const duesAccount = await prisma.duesAccount.findFirst({
      where: { organizationId, memberId: household.orgMemberId, isActive: true, categoryId: { not: null } },
      select: { categoryId: true },
      orderBy: { createdAt: "desc" },
    });
    membershipCategoryId = duesAccount?.categoryId ?? null;
  }

  return {
    householdId,
    currentClassroomIds,
    currentGradeIds,
    membershipCategoryId,
    enrolledChildCount: studentIds.length,
    adultCount,
  };
}

function isTemporaryExemptionExpired(exemptUntil: Date | null, now: Date): boolean {
  return exemptUntil != null && exemptUntil.getTime() < now.getTime();
}

/**
 * Resolution precedence: an individual HOUSEHOLD override always wins;
 * failing that, a PROGRAM group containing this household; then
 * CLASSROOM/GRADE/MEMBERSHIP_PLAN scope matches (in that specificity
 * order); then an org-wide ALL-scope row (if one was explicitly created to
 * override the period default without editing the period itself); and
 * finally the implicit period default (no assignment row at all — never
 * multiplied by child/adult count unless a PER_CHILD/PER_ADULT row exists).
 * A PER_CHILD/PER_ADULT/EXEMPT_TEMPORARY row still participates in this
 * precedence order like any other assignmentType — only its resulting
 * requiredMinutes calculation differs.
 */
export function computeHouseholdRequirement(
  requiredMinutesDefault: number,
  assignments: Array<{
    id: string;
    scopeType: PtaVolunteerScopeType;
    scopeRefId: string | null;
    householdId: string | null;
    assignmentType: PtaVolunteerAssignmentType;
    requiredMinutesOverride: number | null;
    reason: string | null;
    exemptUntil: Date | null;
  }>,
  context: HouseholdScopeContext,
  now: Date = new Date()
): HouseholdRequirementResult {
  const isLive = (a: (typeof assignments)[number]) =>
    !(a.assignmentType === "EXEMPT_TEMPORARY" && isTemporaryExemptionExpired(a.exemptUntil, now));

  const household = assignments.find((a) => a.scopeType === "HOUSEHOLD" && a.householdId === context.householdId && isLive(a));
  const program = assignments.find((a) => a.scopeType === "PROGRAM" && a.householdId === context.householdId && isLive(a));
  const classroom = assignments.find(
    (a) => a.scopeType === "CLASSROOM" && a.scopeRefId && context.currentClassroomIds.includes(a.scopeRefId) && isLive(a)
  );
  const grade = assignments.find(
    (a) => a.scopeType === "GRADE" && a.scopeRefId && context.currentGradeIds.includes(a.scopeRefId) && isLive(a)
  );
  const membershipPlan = assignments.find(
    (a) => a.scopeType === "MEMBERSHIP_PLAN" && a.scopeRefId && a.scopeRefId === context.membershipCategoryId && isLive(a)
  );
  const orgWide = assignments.find((a) => a.scopeType === "ALL" && isLive(a));

  const winner = household ?? program ?? classroom ?? grade ?? membershipPlan ?? orgWide ?? null;

  if (!winner) {
    return {
      requiredMinutes: requiredMinutesDefault,
      assignmentType: "STANDARD",
      matchedScopeType: null,
      assignmentId: null,
      reason: null,
      exempt: false,
    };
  }

  let requiredMinutes: number;
  let exempt = false;
  switch (winner.assignmentType) {
    case "PER_CHILD":
      requiredMinutes = requiredMinutesDefault * context.enrolledChildCount;
      break;
    case "PER_ADULT":
      requiredMinutes = requiredMinutesDefault * context.adultCount;
      break;
    case "CUSTOM":
    case "REDUCED":
      requiredMinutes = winner.requiredMinutesOverride ?? requiredMinutesDefault;
      break;
    case "WAIVER":
      requiredMinutes = winner.requiredMinutesOverride ?? 0;
      exempt = winner.requiredMinutesOverride == null;
      break;
    case "EXEMPT_FULL":
      requiredMinutes = 0;
      exempt = true;
      break;
    case "EXEMPT_TEMPORARY":
      requiredMinutes = 0;
      exempt = true;
      break;
    case "STANDARD":
    default:
      requiredMinutes = requiredMinutesDefault;
      break;
  }

  return {
    requiredMinutes: Math.max(0, requiredMinutes),
    assignmentType: winner.assignmentType,
    matchedScopeType: winner.scopeType,
    assignmentId: winner.id,
    reason: winner.reason,
    exempt,
  };
}

/**
 * VH-I tenant-isolation audit finding: this is the single shared entry
 * point every other module calls with a householdId (elections, purchases,
 * assessments, corrections) — some of those callers pass a client-supplied
 * householdId with no upstream ownership check of their own. Downstream
 * queries (ledger, dues account) are all correctly organizationId-scoped
 * and would silently return empty for a foreign household, so this was
 * never an actual cross-org DATA LEAK — but it would compute a nonsensical
 * "period default, no assignment" result for a household that doesn't
 * belong to this org at all, rather than failing closed. Fixed once here
 * so every caller is protected transitively.
 */
async function assertHouseholdBelongsToOrganization(organizationId: string, householdId: string) {
  const household = await prisma.ptaHousehold.findFirst({ where: { id: householdId, organizationId }, select: { id: true } });
  if (!household) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");
}

export async function resolveHouseholdRequirement(
  organizationId: string,
  periodId: string,
  householdId: string
): Promise<HouseholdRequirementResult> {
  await assertHouseholdBelongsToOrganization(organizationId, householdId);
  const [period, assignments, context] = await Promise.all([
    getVolunteerRequirementPeriod(organizationId, periodId),
    prisma.ptaVolunteerRequirementAssignment.findMany({ where: { organizationId, periodId } }),
    getHouseholdScopeContext(organizationId, householdId),
  ]);
  return computeHouseholdRequirement(period.requiredMinutesDefault, assignments, context);
}

export interface PeriodAssignmentPreviewRow extends HouseholdRequirementResult {
  householdId: string;
  householdDisplayName: string;
}

/** Dry-run table for the whole org, batch-fetched (no N+1 per household) —
 * shown to admins before flipping a period Draft→Active. */
export async function previewPeriodAssignments(organizationId: string, periodId: string): Promise<PeriodAssignmentPreviewRow[]> {
  const [period, assignments, households] = await Promise.all([
    getVolunteerRequirementPeriod(organizationId, periodId),
    prisma.ptaVolunteerRequirementAssignment.findMany({ where: { organizationId, periodId } }),
    prisma.ptaHousehold.findMany({ where: { organizationId, status: "ACTIVE" }, select: { id: true, displayName: true } }),
  ]);

  const contexts = await Promise.all(households.map((h) => getHouseholdScopeContext(organizationId, h.id)));

  return households.map((household, i) => {
    const result = computeHouseholdRequirement(period.requiredMinutesDefault, assignments, contexts[i]);
    return { ...result, householdId: household.id, householdDisplayName: household.displayName };
  });
}
