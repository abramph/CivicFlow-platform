import type { PtaVolunteerPeriodStatus, PtaVolunteerPeriodType } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { PtaError } from "../errors";

export interface VolunteerRequirementPeriodInput {
  name: string;
  periodType: PtaVolunteerPeriodType;
  startsOn: Date;
  endsOn: Date;
  requiredMinutesDefault: number;
  volunteerDeadline?: Date | null;
  buyoutWindowStart?: Date | null;
  buyoutWindowEnd?: Date | null;
  assessmentDate?: Date | null;
  assessmentPaymentDueDate?: Date | null;
  status?: PtaVolunteerPeriodStatus;
  adminNotes?: string | null;
  familyPolicyText?: string | null;
  scopeLabel?: string | null;
}

function validateDates(input: VolunteerRequirementPeriodInput) {
  if (input.startsOn >= input.endsOn) {
    throw new PtaError("PTA_VOLUNTEER_PERIOD_INVALID_DATES", "The period's end date must be after its start date.");
  }
  if (!Number.isInteger(input.requiredMinutesDefault) || input.requiredMinutesDefault < 0) {
    throw new PtaError("PTA_VOLUNTEER_PERIOD_INVALID_DATES", "Required hours must be a non-negative whole number of minutes.");
  }
  const withinRange = (d: Date | null | undefined, label: string) => {
    if (d && (d < input.startsOn || d > input.endsOn)) {
      throw new PtaError("PTA_VOLUNTEER_PERIOD_INVALID_DATES", `${label} must fall within the period's start and end dates.`);
    }
  };
  withinRange(input.volunteerDeadline, "The volunteer completion deadline");
  withinRange(input.buyoutWindowStart, "The buyout window start");
  withinRange(input.buyoutWindowEnd, "The buyout window end");
  if (input.buyoutWindowStart && input.buyoutWindowEnd && input.buyoutWindowStart >= input.buyoutWindowEnd) {
    throw new PtaError("PTA_VOLUNTEER_PERIOD_INVALID_DATES", "The buyout window's end must be after its start.");
  }
  if (!input.name.trim()) {
    throw new PtaError("PTA_VOLUNTEER_PERIOD_INVALID_DATES", "The period needs a name.");
  }
}

/**
 * Two ACTIVE periods are only a conflict when they share a scope (same
 * scopeLabel, or both null) AND their [startsOn, endsOn) ranges intersect.
 * Different scopeLabels are an intentional separate grouping (program,
 * campus, membership type) per the spec — this codebase has no formal
 * campus/program entity to key off instead, so scopeLabel is admin-defined
 * free text. DRAFT/CLOSED/ARCHIVED periods never conflict with anything.
 */
async function assertNoConflictingActivePeriod(
  organizationId: string,
  input: VolunteerRequirementPeriodInput,
  excludePeriodId?: string
) {
  if (input.status !== "ACTIVE") return;

  const candidates = await prisma.ptaVolunteerRequirementPeriod.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      id: excludePeriodId ? { not: excludePeriodId } : undefined,
      scopeLabel: input.scopeLabel ?? null,
    },
    select: { id: true, name: true, startsOn: true, endsOn: true },
  });

  const conflict = candidates.find((c) => input.startsOn < c.endsOn && c.startsOn < input.endsOn);
  if (conflict) {
    throw new PtaError(
      "PTA_VOLUNTEER_PERIOD_CONFLICT",
      `This period's dates overlap with the already-active period "${conflict.name}" in the same scope. Give one of them a distinct scope (program/campus/membership type) or adjust the dates.`
    );
  }
}

export async function listVolunteerRequirementPeriods(organizationId: string) {
  return prisma.ptaVolunteerRequirementPeriod.findMany({
    where: { organizationId },
    orderBy: [{ status: "asc" }, { startsOn: "desc" }],
  });
}

export async function getVolunteerRequirementPeriod(organizationId: string, periodId: string) {
  const period = await prisma.ptaVolunteerRequirementPeriod.findFirst({ where: { id: periodId, organizationId } });
  if (!period) throw new PtaError("PTA_VOLUNTEER_PERIOD_NOT_FOUND", "Volunteer requirement period not found in this organization.");
  return period;
}

/** The ACTIVE period whose date range contains right now — the default a
 * family dashboard resolves to when no periodId is specified. Null when
 * nothing is currently active (between periods, or none configured yet). */
export async function getCurrentActivePeriod(organizationId: string, at: Date = new Date()) {
  return prisma.ptaVolunteerRequirementPeriod.findFirst({
    where: { organizationId, status: "ACTIVE", startsOn: { lte: at }, endsOn: { gt: at } },
    orderBy: { startsOn: "desc" },
  });
}

export async function createVolunteerRequirementPeriod(
  organizationId: string,
  input: VolunteerRequirementPeriodInput,
  actor: { userId: string; userEmail?: string | null }
) {
  validateDates(input);
  await assertNoConflictingActivePeriod(organizationId, input);

  const orgSettings = await prisma.orgSettings.findUnique({ where: { organizationId }, select: { timezone: true } });

  const period = await prisma.ptaVolunteerRequirementPeriod.create({
    data: {
      organizationId,
      name: input.name.trim(),
      periodType: input.periodType,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      timezone: orgSettings?.timezone ?? "America/New_York",
      requiredMinutesDefault: input.requiredMinutesDefault,
      volunteerDeadline: input.volunteerDeadline ?? null,
      buyoutWindowStart: input.buyoutWindowStart ?? null,
      buyoutWindowEnd: input.buyoutWindowEnd ?? null,
      assessmentDate: input.assessmentDate ?? null,
      assessmentPaymentDueDate: input.assessmentPaymentDueDate ?? null,
      status: input.status ?? "DRAFT",
      adminNotes: input.adminNotes ?? null,
      familyPolicyText: input.familyPolicyText ?? null,
      scopeLabel: input.scopeLabel?.trim() || null,
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.period_created",
    entityType: "pta_volunteer_requirement_period",
    entityId: period.id,
    metadata: { name: period.name, status: period.status, requiredMinutesDefault: period.requiredMinutesDefault },
  });

  return period;
}

export async function updateVolunteerRequirementPeriod(
  organizationId: string,
  periodId: string,
  input: VolunteerRequirementPeriodInput,
  actor: { userId: string; userEmail?: string | null }
) {
  const existing = await getVolunteerRequirementPeriod(organizationId, periodId);
  validateDates(input);
  await assertNoConflictingActivePeriod(organizationId, input, periodId);

  const period = await prisma.ptaVolunteerRequirementPeriod.update({
    where: { id: periodId },
    data: {
      name: input.name.trim(),
      periodType: input.periodType,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      requiredMinutesDefault: input.requiredMinutesDefault,
      volunteerDeadline: input.volunteerDeadline ?? null,
      buyoutWindowStart: input.buyoutWindowStart ?? null,
      buyoutWindowEnd: input.buyoutWindowEnd ?? null,
      assessmentDate: input.assessmentDate ?? null,
      assessmentPaymentDueDate: input.assessmentPaymentDueDate ?? null,
      status: input.status ?? existing.status,
      adminNotes: input.adminNotes ?? null,
      familyPolicyText: input.familyPolicyText ?? null,
      scopeLabel: input.scopeLabel?.trim() || null,
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.period_updated",
    entityType: "pta_volunteer_requirement_period",
    entityId: period.id,
    metadata: {
      before: { status: existing.status, requiredMinutesDefault: existing.requiredMinutesDefault },
      after: { status: period.status, requiredMinutesDefault: period.requiredMinutesDefault },
    },
  });

  return period;
}
