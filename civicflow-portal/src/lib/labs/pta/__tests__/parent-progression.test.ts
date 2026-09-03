import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Family-facing progression read surface. The privacy-critical assertions
 * here are the structural ones: this module must never query the
 * progression batch/record tables, and must never publish a placement that
 * isn't a committed, non-rolled-back target-year enrollment.
 */

const findUniqueProfile = vi.fn();
const findManyYear = vi.fn();
const findManyStudent = vi.fn();
const findManyEnrollment = vi.fn();
/** Deliberately wired so that ANY read of the administrative progression
 * tables throws — that is what makes "families never see preview/audit
 * data" a proven property rather than a promise. */
const forbiddenBatchAccess = vi.fn((..._args: unknown[]): never => {
  throw new Error("parent-progression must never read PtaStudentProgressionBatch");
});
const forbiddenRecordAccess = vi.fn((..._args: unknown[]): never => {
  throw new Error("parent-progression must never read PtaStudentProgressionRecord");
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaProfile: { findUnique: (...a: unknown[]) => findUniqueProfile(...a) },
    ptaSchoolYear: { findMany: (...a: unknown[]) => findManyYear(...a) },
    ptaStudent: { findMany: (...a: unknown[]) => findManyStudent(...a) },
    ptaStudentEnrollment: { findMany: (...a: unknown[]) => findManyEnrollment(...a) },
    ptaStudentProgressionBatch: {
      findMany: (...a: unknown[]) => forbiddenBatchAccess(...a),
      findFirst: (...a: unknown[]) => forbiddenBatchAccess(...a),
      findUnique: (...a: unknown[]) => forbiddenBatchAccess(...a),
    },
    ptaStudentProgressionRecord: {
      findMany: (...a: unknown[]) => forbiddenRecordAccess(...a),
      findFirst: (...a: unknown[]) => forbiddenRecordAccess(...a),
      findUnique: (...a: unknown[]) => forbiddenRecordAccess(...a),
    },
  },
}));

const isPtaStudentProgressionPlatformEnabled = vi.fn();
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, isPtaStudentProgressionPlatformEnabled: () => isPtaStudentProgressionPlatformEnabled() };
});

import { getPtaParentProgressionSummary } from "../parent-progression";

const ORG = "org-1";
const HOUSEHOLD = "household-1";

const YEARS = [
  { id: "y-prev", label: "2025-2026", isCurrent: false },
  { id: "y-cur", label: "2026-2027", isCurrent: true },
  { id: "y-next", label: "2027-2028", isCurrent: false },
];

function enrollment(studentId: string, yearId: string, yearLabel: string, grade: string, classroom: string) {
  return { studentId, schoolYearId: yearId, schoolYear: yearLabel, classroom: { name: classroom, grade: { name: grade } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  isPtaStudentProgressionPlatformEnabled.mockReturnValue(true);
  findUniqueProfile.mockResolvedValue({ studentProgressionEnabled: true });
  findManyYear.mockResolvedValue(YEARS);
  findManyStudent.mockResolvedValue([]);
  findManyEnrollment.mockResolvedValue([]);
});

describe("getPtaParentProgressionSummary — feature gating (both flags default OFF)", () => {
  it("denies when the platform kill-switch is off, before any student query", async () => {
    isPtaStudentProgressionPlatformEnabled.mockReturnValue(false);
    await expect(getPtaParentProgressionSummary(ORG, HOUSEHOLD)).rejects.toMatchObject({
      code: "PTA_STUDENT_PROGRESSION_PLATFORM_DISABLED",
    });
    expect(findManyStudent).not.toHaveBeenCalled();
    expect(findManyEnrollment).not.toHaveBeenCalled();
  });

  it("denies when the organization flag is off", async () => {
    findUniqueProfile.mockResolvedValue({ studentProgressionEnabled: false });
    await expect(getPtaParentProgressionSummary(ORG, HOUSEHOLD)).rejects.toMatchObject({
      code: "PTA_STUDENT_PROGRESSION_DISABLED",
    });
    expect(findManyStudent).not.toHaveBeenCalled();
  });

  it("denies when the organization has no PTA profile row at all", async () => {
    findUniqueProfile.mockResolvedValue(null);
    await expect(getPtaParentProgressionSummary(ORG, HOUSEHOLD)).rejects.toMatchObject({
      code: "PTA_STUDENT_PROGRESSION_DISABLED",
    });
  });
});

describe("getPtaParentProgressionSummary — tenant and family scoping", () => {
  it("scopes students to the caller's own organization AND household", async () => {
    await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(findManyStudent).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG, householdId: HOUSEHOLD, status: "ACTIVE" } })
    );
  });

  it("scopes enrollments to the caller's organization and only their own students", async () => {
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    const where = findManyEnrollment.mock.calls[0][0].where;
    expect(where.organizationId).toBe(ORG);
    expect(where.studentId).toEqual({ in: ["s-1"] });
    // Rolled-back / corrected-away placements are INACTIVE, never deleted —
    // they must not surface to a family.
    expect(where.status).toBe("ACTIVE");
  });

  it("a household id from another tenant yields no students rather than leaking", async () => {
    findManyStudent.mockResolvedValue([]);
    const summary = await getPtaParentProgressionSummary(ORG, "household-from-another-org");
    expect(summary.students).toEqual([]);
  });

  it("never reads the administrative progression batch or record tables", async () => {
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    findManyEnrollment.mockResolvedValue([enrollment("s-1", "y-cur", "2026-2027", "2nd Grade", "Room 4")]);
    await expect(getPtaParentProgressionSummary(ORG, HOUSEHOLD)).resolves.toBeTruthy();
    expect(forbiddenBatchAccess).not.toHaveBeenCalled();
    expect(forbiddenRecordAccess).not.toHaveBeenCalled();
  });

  it("is bounded — three queries regardless of how many children the family has", async () => {
    findManyStudent.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({ id: `s-${i}`, displayName: `Child ${i}` }))
    );
    await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(findManyYear).toHaveBeenCalledTimes(1);
    expect(findManyStudent).toHaveBeenCalledTimes(1);
    expect(findManyEnrollment).toHaveBeenCalledTimes(1);
  });
});

describe("getPtaParentProgressionSummary — publication rule", () => {
  it("publishes a confirmed next-year placement when a committed target enrollment exists", async () => {
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    findManyEnrollment.mockResolvedValue([
      enrollment("s-1", "y-cur", "2026-2027", "5th Grade", "Room 12"),
      enrollment("s-1", "y-next", "2027-2028", "6th Grade", "Room 20"),
    ]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.currentSchoolYear).toBe("2026-2027");
    expect(summary.nextSchoolYear).toBe("2027-2028");
    expect(summary.students[0]).toMatchObject({
      displayName: "Ada",
      currentGrade: "5th Grade",
      currentClassroom: "Room 12",
      nextGrade: "6th Grade",
      nextClassroom: "Room 20",
      status: "CONFIRMED",
    });
  });

  it("shows only the current placement, and no next-year data, when the target enrollment does not exist", async () => {
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    findManyEnrollment.mockResolvedValue([enrollment("s-1", "y-cur", "2026-2027", "2nd Grade", "Room 4")]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.students[0]).toMatchObject({
      currentGrade: "2nd Grade",
      nextGrade: null,
      nextClassroom: null,
      status: "NOT_YET_AVAILABLE",
    });
  });

  it("treats NEEDS_REVIEW / excluded / skipped / graduated / transferred / withdrawn identically — all have no target enrollment, so none is distinguishable", async () => {
    // Each of those administrative outcomes leaves no ACTIVE target-year
    // enrollment. The family result must be byte-identical in every case.
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    findManyEnrollment.mockResolvedValue([enrollment("s-1", "y-cur", "2026-2027", "8th Grade", "Room 1")]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    const student = summary.students[0];
    expect(student.status).toBe("NOT_YET_AVAILABLE");
    expect(student.nextGrade).toBeNull();
    expect(student.nextClassroom).toBeNull();
    // No outcome/reason/notes field is exposed at all.
    expect(Object.keys(student).sort()).toEqual(
      ["currentClassroom", "currentGrade", "displayName", "nextClassroom", "nextGrade", "status", "studentId"].sort()
    );
  });

  it("does not publish a placement carried on an INACTIVE (rolled-back) enrollment — those are filtered at the query level", async () => {
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    // The service asks Prisma for status: "ACTIVE" only, so a rolled-back
    // row never reaches it.
    findManyEnrollment.mockResolvedValue([enrollment("s-1", "y-cur", "2026-2027", "3rd Grade", "Room 7")]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(findManyEnrollment.mock.calls[0][0].where.status).toBe("ACTIVE");
    expect(summary.students[0].nextGrade).toBeNull();
  });

  it("matches legacy enrollments that carry only the free-text school-year label (null schoolYearId)", async () => {
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    findManyEnrollment.mockResolvedValue([
      { studentId: "s-1", schoolYearId: null, schoolYear: "2026-2027", classroom: { name: "Room 9", grade: { name: "1st Grade" } } },
    ]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.students[0].currentGrade).toBe("1st Grade");
  });
});

describe("getPtaParentProgressionSummary — family shapes and statuses", () => {
  it("handles multiple students progressing differently in one family, in deterministic order", async () => {
    findManyStudent.mockResolvedValue([
      { id: "s-a", displayName: "Ada" },
      { id: "s-b", displayName: "Ben" },
    ]);
    findManyEnrollment.mockResolvedValue([
      enrollment("s-a", "y-cur", "2026-2027", "5th Grade", "Room 12"),
      enrollment("s-a", "y-next", "2027-2028", "6th Grade", "Room 20"),
      enrollment("s-b", "y-cur", "2026-2027", "2nd Grade", "Room 4"),
    ]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.students.map((s) => s.displayName)).toEqual(["Ada", "Ben"]);
    expect(summary.students[0].status).toBe("CONFIRMED");
    expect(summary.students[1].status).toBe("NOT_YET_AVAILABLE");
    expect(findManyStudent.mock.calls[0][0].orderBy).toEqual([{ displayName: "asc" }, { id: "asc" }]);
  });

  it("reports a student with no current placement at all as not yet available", async () => {
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    findManyEnrollment.mockResolvedValue([]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.students[0]).toMatchObject({ currentGrade: null, currentClassroom: null, status: "NOT_YET_AVAILABLE" });
  });

  it("returns an empty student list for a family with no students", async () => {
    findManyStudent.mockResolvedValue([]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.students).toEqual([]);
    expect(summary.currentSchoolYear).toBe("2026-2027");
  });

  it("degrades safely when the organization has no current school year defined", async () => {
    findManyYear.mockResolvedValue([{ id: "y-x", label: "2026-2027", isCurrent: false }]);
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.currentSchoolYear).toBeNull();
    expect(summary.nextSchoolYear).toBeNull();
    expect(summary.students[0].status).toBe("NOT_YET_AVAILABLE");
  });

  it("reports COMPLETED when the student rolled into the active year and no later year is defined", async () => {
    findManyYear.mockResolvedValue([
      { id: "y-prev", label: "2025-2026", isCurrent: false },
      { id: "y-cur", label: "2026-2027", isCurrent: true },
    ]);
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    findManyEnrollment.mockResolvedValue([
      enrollment("s-1", "y-prev", "2025-2026", "4th Grade", "Room 3"),
      enrollment("s-1", "y-cur", "2026-2027", "5th Grade", "Room 12"),
    ]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.students[0].status).toBe("COMPLETED");
    expect(summary.nextSchoolYear).toBeNull();
  });

  it("reports CURRENT for a first-year student with no prior history and no later year defined", async () => {
    findManyYear.mockResolvedValue([{ id: "y-cur", label: "2026-2027", isCurrent: true }]);
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    findManyEnrollment.mockResolvedValue([enrollment("s-1", "y-cur", "2026-2027", "Kindergarten", "Room 1")]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.students[0].status).toBe("CURRENT");
  });

  it("skips a year gap when choosing the next year (2026-2027 → 2028-2029)", async () => {
    findManyYear.mockResolvedValue([
      { id: "y-cur", label: "2026-2027", isCurrent: true },
      { id: "y-gap", label: "2028-2029", isCurrent: false },
    ]);
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.nextSchoolYear).toBe("2028-2029");
  });

  it("ignores non-canonical year labels that cannot be ordered numerically", async () => {
    findManyYear.mockResolvedValue([
      { id: "y-cur", label: "2026-2027", isCurrent: true },
      { id: "y-odd", label: "Summer Term", isCurrent: false },
    ]);
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.nextSchoolYear).toBeNull();
  });
});
