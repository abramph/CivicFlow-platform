import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";

/**
 * PTA Vertical 2.0, PR PTA-A — school years as a first-class entity (see
 * docs/pta-vertical-2.md). The historical free-text labels
 * (PtaProfile.currentSchoolYear + `schoolYear` columns) remain authoritative
 * for every existing read path; this module keeps the two worlds coherent:
 *
 *  - setCurrentSchoolYear() updates BOTH PtaSchoolYear.isCurrent and
 *    PtaProfile.currentSchoolYear in one transaction, so string-based readers
 *    follow the entity without being rewritten in this PR.
 *  - resolveSchoolYearId() is the dual-write hook the household/classroom/
 *    enrollment/volunteer-opportunity create paths call to stamp the FK twin
 *    of the label they already write.
 */

const LABEL_PATTERN = /^(\d{4})-(\d{4})$/;

/** Parses a canonical "YYYY-YYYY" label. Returns null for anything else —
 * historical data may hold arbitrary strings and must still round-trip, so
 * only NEW years created through createSchoolYear() are held to the format. */
export function parseSchoolYearLabel(label: string): { startYear: number; endYear: number } | null {
  const match = LABEL_PATTERN.exec(label.trim());
  if (!match) return null;
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  if (endYear !== startYear + 1) return null;
  return { startYear, endYear };
}

/** "2026-2027" → "2027-2028"; null when the label isn't canonical. */
export function deriveNextLabel(label: string): string | null {
  const parsed = parseSchoolYearLabel(label);
  if (!parsed) return null;
  return `${parsed.startYear + 1}-${parsed.endYear + 1}`;
}

/** "2026-2027" → "2025-2026"; null when the label isn't canonical. */
export function derivePreviousLabel(label: string): string | null {
  const parsed = parseSchoolYearLabel(label);
  if (!parsed) return null;
  return `${parsed.startYear - 1}-${parsed.endYear - 1}`;
}

export async function listSchoolYears(organizationId: string) {
  return prisma.ptaSchoolYear.findMany({
    where: { organizationId },
    orderBy: [{ label: "desc" }],
  });
}

/**
 * Current / previous / next in one shot for pickers and the Transition Center
 * (PTA-F). Previous/next are resolved by canonical-label arithmetic against
 * the rows that actually exist — an org whose labels aren't canonical simply
 * gets nulls, never a guess.
 */
export async function getSchoolYearContext(organizationId: string) {
  const years = await listSchoolYears(organizationId);
  const current = years.find((year) => year.isCurrent) ?? null;
  const previousLabel = current ? derivePreviousLabel(current.label) : null;
  const nextLabel = current ? deriveNextLabel(current.label) : null;
  return {
    years,
    current,
    previous: previousLabel ? (years.find((year) => year.label === previousLabel) ?? null) : null,
    next: nextLabel ? (years.find((year) => year.label === nextLabel) ?? null) : null,
    suggestedNextLabel: nextLabel,
  };
}

/**
 * Find-or-create by (organization, label) — the dual-write hook. Safe under
 * concurrency via upsert on the composite unique; never flips isCurrent.
 * Blank labels resolve to null rather than minting a nonsense year row.
 */
export async function resolveSchoolYearId(organizationId: string, label: string | null | undefined): Promise<string | null> {
  const trimmed = label?.trim();
  if (!trimmed) return null;
  const year = await prisma.ptaSchoolYear.upsert({
    where: { organizationId_label: { organizationId, label: trimmed } },
    create: { organizationId, label: trimmed },
    update: {},
  });
  return year.id;
}

export interface CreateSchoolYearInput {
  organizationId: string;
  label: string;
  startsOn?: Date | null;
  endsOn?: Date | null;
  makeCurrent?: boolean;
  actorUserId: string;
  actorEmail?: string | null;
}

/** Creates a new (typically upcoming) school year. Preparing the next year
 * ahead of time is the whole point — creating one never changes the active
 * year unless makeCurrent is passed explicitly. */
export async function createSchoolYear(input: CreateSchoolYearInput) {
  const label = input.label.trim();
  if (!parseSchoolYearLabel(label)) {
    throw new PtaError("PTA_VALIDATION_ERROR", 'School year must look like "2026-2027" (two consecutive years).');
  }
  const existing = await prisma.ptaSchoolYear.findUnique({
    where: { organizationId_label: { organizationId: input.organizationId, label } },
  });
  if (existing) throw new PtaError("PTA_VALIDATION_ERROR", `School year ${label} already exists.`);

  const year = await prisma.ptaSchoolYear.create({
    data: {
      organizationId: input.organizationId,
      label,
      startsOn: input.startsOn ?? null,
      endsOn: input.endsOn ?? null,
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.school_year.created",
    entityType: "pta_school_year",
    entityId: year.id,
    metadata: { label },
  });

  if (input.makeCurrent) {
    return setCurrentSchoolYear({
      organizationId: input.organizationId,
      schoolYearId: year.id,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
    });
  }
  return year;
}

export interface SetCurrentSchoolYearInput {
  organizationId: string;
  schoolYearId: string;
  actorUserId: string;
  actorEmail?: string | null;
}

/**
 * Flips the org's current year — transactionally unsets every other row,
 * sets this one, and keeps PtaProfile.currentSchoolYear (the label every
 * existing read path still consults) in lockstep. The single-current
 * invariant lives here, not in a trigger.
 */
export async function setCurrentSchoolYear(input: SetCurrentSchoolYearInput) {
  const year = await prisma.ptaSchoolYear.findFirst({
    where: { id: input.schoolYearId, organizationId: input.organizationId },
  });
  if (!year) throw new PtaError("PTA_SCHOOL_YEAR_NOT_FOUND", "School year not found.");

  const [, updated] = await prisma.$transaction([
    prisma.ptaSchoolYear.updateMany({
      where: { organizationId: input.organizationId, isCurrent: true, id: { not: year.id } },
      data: { isCurrent: false },
    }),
    prisma.ptaSchoolYear.update({ where: { id: year.id }, data: { isCurrent: true } }),
    prisma.ptaProfile.updateMany({
      where: { organizationId: input.organizationId },
      data: { currentSchoolYear: year.label },
    }),
  ]);

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.school_year.set_current",
    entityType: "pta_school_year",
    entityId: year.id,
    metadata: { label: year.label },
  });

  return updated;
}
