import { prisma } from "@/lib/prisma";
import { parseSchoolYearLabel } from "./school-years";
import { assertProgressionEnabled } from "./student-progression";

/**
 * Parent/family-facing READ-ONLY view of student progression.
 *
 * The single most important property of this module: **it never reads
 * `PtaStudentProgressionBatch` or `PtaStudentProgressionRecord` at all.**
 * Everything a family sees is derived purely from committed
 * `PtaStudentEnrollment` rows (plus classroom/grade/school-year lookups).
 * That is a structural privacy guarantee, not a filtering convention —
 * preview calculations, draft classroom mappings, NEEDS_REVIEW state,
 * administrator notes, conflict details, audit actors, batch idempotency
 * keys and outcome codes are simply not reachable from here, so no future
 * edit to this file can accidentally leak one.
 *
 * Why enrollment rows alone are a safe publication signal (verified
 * against student-progression.ts, not assumed):
 *   - `previewProgressionBatch` only ever READS enrollments; it writes
 *     `PtaStudentProgressionRecord` rows in PLANNED state and creates no
 *     enrollment.
 *   - Target-year `PtaStudentEnrollment` rows are created in exactly two
 *     places, both inside `commitProgressionBatch`/`correctProgressionRecord`,
 *     and always with `status: "ACTIVE"`.
 *   - Correcting a student away from an enrolling outcome, and rolling a
 *     batch back, both set that row to `status: "INACTIVE"` rather than
 *     deleting it.
 * So "an ACTIVE enrollment row exists for the target year" is, by
 * construction, equivalent to "this placement was committed and has not
 * been rolled back" — which is the safest available publication rule given
 * that `PtaEnrollmentStatus` has no explicit publish/visibility state.
 * A student who is NEEDS_REVIEW, SKIPPED, excluded, graduated,
 * transferred or withdrawn has no ACTIVE target-year enrollment and is
 * therefore reported identically as "not yet available" — the family
 * cannot distinguish those cases, which is intended.
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

  return {
    currentSchoolYear: current.label,
    nextSchoolYear: next?.label ?? null,
    students: students.map((student) => {
      const own = enrollments.filter((e) => e.studentId === student.id);
      const currentEnrollment = own.find((e) => matches(e, current)) ?? null;
      const nextEnrollment = own.find((e) => matches(e, next)) ?? null;
      const hasPreviousEnrollment = own.some((e) => matches(e, previous));

      let status: PtaParentProgressionStatus;
      if (nextEnrollment) {
        // Committed and not rolled back — the only case that publishes a
        // future placement.
        status = "CONFIRMED";
      } else if (!currentEnrollment) {
        status = "NOT_YET_AVAILABLE";
      } else if (next) {
        // A later year exists but this student has no committed placement
        // in it yet. Covers not-yet-run, NEEDS_REVIEW, skipped, excluded,
        // graduated, transferred and withdrawn alike — indistinguishably.
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
      };
    }),
  };
}
