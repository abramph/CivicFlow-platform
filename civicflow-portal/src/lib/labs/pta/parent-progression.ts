import { prisma } from "@/lib/prisma";
import { parseSchoolYearLabel } from "./school-years";
import { assertProgressionEnabled } from "./student-progression";

/**
 * Parent/family-facing READ-ONLY view of student progression.
 *
 * ## Visibility rule
 *
 * A student's **current-year** placement is always shown — that is their
 * ordinary, already-official enrollment and has nothing to do with
 * progression disclosure.
 *
 * A **future-year** placement is shown **only when an administrator has
 * explicitly published** the progression batch that produced it. A
 * committed target enrollment is necessary but NOT sufficient: committing
 * is the office finishing its data work, publishing is the school deciding
 * families should be told. Those are different decisions, and this module
 * gates on the second.
 *
 * Concretely, a future placement is published only when ALL of:
 *   - an ACTIVE target-year `PtaStudentEnrollment` exists (so it was
 *     committed, and not rolled back or corrected away — both of those set
 *     the row INACTIVE rather than deleting it), AND
 *   - the `PtaStudentProgressionRecord` linking that enrollment is APPLIED
 *     with a real placement outcome, AND
 *   - its batch's `publicationStatus` is `PUBLISHED` (not UNPUBLISHED, not
 *     WITHDRAWN).
 *
 * ## Minimal-access principle
 *
 * This module previously never touched the progression tables at all. It
 * now must, because publication state lives there — but it reads the
 * **minimum** needed and nothing else:
 *   - from the record: `targetEnrollmentId`, `outcome`, `status` (to
 *     confirm a real applied placement) — never `exceptionReason`, never
 *     the source/target grade/classroom mapping ids, never audit fields.
 *   - from the batch: `publicationStatus` only — never `publishedByUserId`,
 *     `publishIdempotencyKey`, `commitIdempotencyKey`, `notes`,
 *     `previewedAt`, or any actor/timestamp beyond what a family display
 *     needs.
 * Nothing about *why* a placement is unavailable ever leaves this module.
 * A student who is NEEDS_REVIEW, skipped, excluded, graduated, transferred,
 * withdrawn, committed-but-unpublished, or withdrawn-after-publication all
 * produce byte-identical output: no next placement, status
 * `NOT_YET_AVAILABLE`. The family cannot distinguish them, which is the
 * point.
 *
 * Deliberately NOT introduced here: graduated/transferred/withdrawn
 * wording. Those outcomes mark only the progression record APPLIED; they
 * do not deactivate `PtaStudent` and do not create a target enrollment, and
 * the product has no existing family-visible convention for announcing
 * them. Inventing one would risk telling a family something sensitive
 * before an administrator has communicated it, so this surface stays
 * silent and simply shows no next-year placement.
 */

/** Family-facing status. Deliberately a tiny, safe vocabulary — never a
 * raw internal record status or outcome code. */
export type PtaParentProgressionStatus = "CURRENT" | "CONFIRMED" | "NOT_YET_AVAILABLE" | "COMPLETED";

export interface PtaParentProgressionStudent {
  /** The student's own id. Safe for the mobile client: it is only ever
   * usable through this same self-access-scoped endpoint, which never
   * accepts a student or household id from the client. */
  studentId: string;
  displayName: string;
  currentGrade: string | null;
  currentClassroom: string | null;
  /** Populated only for a committed, non-rolled-back target-year placement. */
  nextGrade: string | null;
  nextClassroom: string | null;
  status: PtaParentProgressionStatus;
  /** Whether a future placement is actually published for this student.
   * Never explains *why* not — an unpublished, unresolved, excluded,
   * withdrawn or rolled-back student all report NOT_AVAILABLE. */
  publicationStatus: "NOT_AVAILABLE" | "PUBLISHED";
}

export interface PtaParentProgressionSummary {
  currentSchoolYear: string | null;
  /** The next school year the organization has actually defined, if any.
   * Its presence does not imply any student has a published placement. */
  nextSchoolYear: string | null;
  students: PtaParentProgressionStudent[];
}

interface YearRef {
  id: string;
  label: string;
}

/** Picks the organization's next school year: the defined year with the
 * smallest start year strictly after the current one. Tolerates a gap
 * (e.g. current 2026-2027, next defined 2028-2029) and ignores
 * non-canonical labels, which cannot be ordered numerically. */
function pickAdjacentYears(
  years: { id: string; label: string; isCurrent: boolean }[]
): { current: YearRef | null; previous: YearRef | null; next: YearRef | null } {
  const current = years.find((y) => y.isCurrent) ?? null;
  if (!current) return { current: null, previous: null, next: null };

  const currentParsed = parseSchoolYearLabel(current.label);
  if (!currentParsed) {
    return { current: { id: current.id, label: current.label }, previous: null, next: null };
  }

  let next: (YearRef & { startYear: number }) | null = null;
  let previous: (YearRef & { startYear: number }) | null = null;
  for (const year of years) {
    if (year.id === current.id) continue;
    const parsed = parseSchoolYearLabel(year.label);
    if (!parsed) continue;
    if (parsed.startYear > currentParsed.startYear) {
      if (!next || parsed.startYear < next.startYear) next = { id: year.id, label: year.label, startYear: parsed.startYear };
    } else if (parsed.startYear < currentParsed.startYear) {
      if (!previous || parsed.startYear > previous.startYear) previous = { id: year.id, label: year.label, startYear: parsed.startYear };
    }
  }

  return {
    current: { id: current.id, label: current.label },
    previous: previous ? { id: previous.id, label: previous.label } : null,
    next: next ? { id: next.id, label: next.label } : null,
  };
}

/**
 * Read-only progression summary for one household's own students.
 *
 * `householdId` is always supplied by the caller's server-resolved
 * self-access context (`requirePtaHouseholdSelfAccess` /
 * `requireMobilePtaHouseholdAccess`) — never by the client. Every query
 * below is additionally scoped by `organizationId`, so a household id from
 * another tenant resolves to an empty result rather than leaking anything.
 *
 * Bounded and N+1-free: at most three queries regardless of family size
 * (school years, students, then one batched enrollment fetch).
 */
export async function getPtaParentProgressionSummary(
  organizationId: string,
  householdId: string
): Promise<PtaParentProgressionSummary> {
  await assertProgressionEnabled(organizationId);

  const schoolYears = await prisma.ptaSchoolYear.findMany({
    where: { organizationId },
    select: { id: true, label: true, isCurrent: true },
  });
  const { current, previous, next } = pickAdjacentYears(schoolYears);

  const students = await prisma.ptaStudent.findMany({
    where: { organizationId, householdId, status: "ACTIVE" },
    select: { id: true, displayName: true },
    // Deterministic ordering for multiple children; id breaks ties so the
    // list never reshuffles between refreshes for same-named siblings.
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
  });

  if (students.length === 0 || !current) {
    return {
      currentSchoolYear: current?.label ?? null,
      nextSchoolYear: next?.label ?? null,
      students: students.map((student) => ({
        studentId: student.id,
        displayName: student.displayName,
        currentGrade: null,
        currentClassroom: null,
        nextGrade: null,
        nextClassroom: null,
        status: "NOT_YET_AVAILABLE" as const,
        publicationStatus: "NOT_AVAILABLE" as const,
      })),
    };
  }

  const relevantYears = [current, previous, next].filter((y): y is YearRef => y !== null);
  const enrollments = await prisma.ptaStudentEnrollment.findMany({
    where: {
      organizationId,
      studentId: { in: students.map((s) => s.id) },
      // ACTIVE only — a rolled-back or corrected-away placement is set
      // INACTIVE rather than deleted, and must never surface to a family.
      status: "ACTIVE",
      // Match on both the normalized id and the historical free-text label:
      // `schoolYearId` is nullable, so pre-normalization rows carry only
      // `schoolYear`.
      OR: [{ schoolYearId: { in: relevantYears.map((y) => y.id) } }, { schoolYear: { in: relevantYears.map((y) => y.label) } }],
    },
    select: {
      id: true,
      studentId: true,
      schoolYearId: true,
      schoolYear: true,
      classroom: { select: { name: true, grade: { select: { name: true } } } },
    },
  });

  const matches = (
    enrollment: { schoolYearId: string | null; schoolYear: string },
    year: YearRef | null
  ): boolean => (year ? enrollment.schoolYearId === year.id || enrollment.schoolYear === year.label : false);

  // Which of those enrollments are actually PUBLISHED to families?
  //
  // Only future-year enrollments need this check — a current-year placement
  // is the student's ordinary official enrollment and is always shown. The
  // query deliberately selects the minimum: which enrollment id, and
  // nothing from the batch beyond the fact that it matched
  // publicationStatus PUBLISHED. No actor, timestamp, key, note or mapping
  // is read, so none can leak.
  const nextYearEnrollmentIds = next
    ? enrollments.filter((e) => matches(e, next)).map((e) => e.id)
    : [];
  const publishedEnrollmentIds = new Set<string>();
  if (nextYearEnrollmentIds.length > 0) {
    const publishedRecords = await prisma.ptaStudentProgressionRecord.findMany({
      where: {
        organizationId,
        targetEnrollmentId: { in: nextYearEnrollmentIds },
        // A real, applied placement — not PLANNED, SKIPPED or FAILED.
        status: "APPLIED",
        // Never disclose a still-unresolved review or an explicit exclusion,
        // even if some other path had produced an enrollment for it.
        outcome: { notIn: ["NEEDS_REVIEW", "EXCLUDE", "GRADUATE", "TRANSFER", "WITHDRAW"] },
        // The publication gate itself.
        batch: { organizationId, publicationStatus: "PUBLISHED" },
      },
      select: { targetEnrollmentId: true },
    });
    for (const record of publishedRecords) {
      if (record.targetEnrollmentId) publishedEnrollmentIds.add(record.targetEnrollmentId);
    }
  }

  return {
    currentSchoolYear: current.label,
    nextSchoolYear: next?.label ?? null,
    students: students.map((student) => {
      const own = enrollments.filter((e) => e.studentId === student.id);
      const currentEnrollment = own.find((e) => matches(e, current)) ?? null;
      const hasPreviousEnrollment = own.some((e) => matches(e, previous));
      // Future placement only counts once it is PUBLISHED. A committed but
      // unpublished (or withdrawn) placement is treated exactly as if it
      // did not exist.
      const nextEnrollment = own.find((e) => matches(e, next) && publishedEnrollmentIds.has(e.id)) ?? null;

      let status: PtaParentProgressionStatus;
      if (nextEnrollment) {
        status = "CONFIRMED";
      } else if (!currentEnrollment) {
        status = "NOT_YET_AVAILABLE";
      } else if (next) {
        // A later year exists but nothing is published for this student.
        // Covers not-yet-run, committed-but-unpublished, withdrawn,
        // NEEDS_REVIEW, skipped, excluded, graduated, transferred, withdrawn
        // and rolled-back alike — all indistinguishable.
        status = "NOT_YET_AVAILABLE";
      } else if (hasPreviousEnrollment) {
        // Rolled into the active year and no further year is defined:
        // progression into the active target year is complete.
        status = "COMPLETED";
      } else {
        status = "CURRENT";
      }

      return {
        studentId: student.id,
        displayName: student.displayName,
        currentGrade: currentEnrollment?.classroom.grade.name ?? null,
        currentClassroom: currentEnrollment?.classroom.name ?? null,
        nextGrade: nextEnrollment?.classroom.grade.name ?? null,
        nextClassroom: nextEnrollment?.classroom.name ?? null,
        status,
        publicationStatus: nextEnrollment ? ("PUBLISHED" as const) : ("NOT_AVAILABLE" as const),
      };
    }),
  };
}
