import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Family-facing progression read surface, after publication control.
 *
 * The privacy assertions here are the load-bearing ones:
 *   - a COMMITTED but UNPUBLISHED future placement is invisible;
 *   - only an explicitly PUBLISHED one appears;
 *   - the module reads the MINIMUM publication state it needs and never
 *     selects batch internals (actor, timestamps, idempotency keys, notes,
 *     mappings, exception reasons).
 *
 * The previous version of this file asserted that the progression tables
 * were never touched at all. That is no longer true or desirable —
 * publication state lives on the batch — so that blanket prohibition is
 * replaced by the stricter, more useful check above: what is selected, and
 * what can therefore possibly leak.
 */

const findUniqueProfile = vi.fn();
const findManyYear = vi.fn();
const findManyStudent = vi.fn();
const findManyEnrollment = vi.fn();
const findManyRecord = vi.fn();
/** Batch reads must go through the record->batch relation filter, never a
 * direct batch query from this module. */
const forbiddenBatchAccess = vi.fn((..._args: unknown[]): never => {
  throw new Error("parent-progression must not query PtaStudentProgressionBatch directly");
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaProfile: { findUnique: (...a: unknown[]) => findUniqueProfile(...a) },
    ptaSchoolYear: { findMany: (...a: unknown[]) => findManyYear(...a) },
    ptaStudent: { findMany: (...a: unknown[]) => findManyStudent(...a) },
    ptaStudentEnrollment: { findMany: (...a: unknown[]) => findManyEnrollment(...a) },
    ptaStudentProgressionRecord: { findMany: (...a: unknown[]) => findManyRecord(...a) },
    ptaStudentProgressionBatch: {
      findMany: (...a: unknown[]) => forbiddenBatchAccess(...a),
      findFirst: (...a: unknown[]) => forbiddenBatchAccess(...a),
      findUnique: (...a: unknown[]) => forbiddenBatchAccess(...a),
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

function enrollment(id: string, studentId: string, yearId: string, yearLabel: string, grade: string, classroom: string) {
  return { id, studentId, schoolYearId: yearId, schoolYear: yearLabel, classroom: { name: classroom, grade: { name: grade } } };
}

/** Simulates the publication join returning the given target enrollment ids
 * as PUBLISHED. An empty result means nothing is published. */
function published(...targetEnrollmentIds: string[]) {
  findManyRecord.mockResolvedValue(targetEnrollmentIds.map((targetEnrollmentId) => ({ targetEnrollmentId })));
}

beforeEach(() => {
  vi.clearAllMocks();
  isPtaStudentProgressionPlatformEnabled.mockReturnValue(true);
  findUniqueProfile.mockResolvedValue({ studentProgressionEnabled: true });
  findManyYear.mockResolvedValue(YEARS);
  findManyStudent.mockResolvedValue([]);
  findManyEnrollment.mockResolvedValue([]);
  findManyRecord.mockResolvedValue([]);
});

describe("parent progression — feature gating (both flags default OFF)", () => {
  it("denies when the platform kill-switch is off, before any student query", async () => {
    isPtaStudentProgressionPlatformEnabled.mockReturnValue(false);
    await expect(getPtaParentProgressionSummary(ORG, HOUSEHOLD)).rejects.toMatchObject({
      code: "PTA_STUDENT_PROGRESSION_PLATFORM_DISABLED",
    });
    expect(findManyStudent).not.toHaveBeenCalled();
    expect(findManyEnrollment).not.toHaveBeenCalled();
    expect(findManyRecord).not.toHaveBeenCalled();
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

describe("parent progression — publication gate", () => {
  beforeEach(() => {
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    findManyEnrollment.mockResolvedValue([
      enrollment("e-cur", "s-1", "y-cur", "2026-2027", "5th Grade", "Room 12"),
      enrollment("e-next", "s-1", "y-next", "2027-2028", "6th Grade", "Room 20"),
    ]);
  });

  it("HIDES a committed but UNPUBLISHED future placement", async () => {
    published(); // nothing published
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.students[0]).toMatchObject({
      currentGrade: "5th Grade",
      currentClassroom: "Room 12",
      nextGrade: null,
      nextClassroom: null,
      status: "NOT_YET_AVAILABLE",
      publicationStatus: "NOT_AVAILABLE",
    });
  });

  it("SHOWS the future placement once it is published", async () => {
    published("e-next");
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.students[0]).toMatchObject({
      currentGrade: "5th Grade",
      nextGrade: "6th Grade",
      nextClassroom: "Room 20",
      status: "CONFIRMED",
      publicationStatus: "PUBLISHED",
    });
  });

  it("keeps the CURRENT placement visible regardless of publication state", async () => {
    published();
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    // Publication gating applies to future results only — a student's
    // ordinary current-year placement is never withheld.
    expect(summary.students[0].currentGrade).toBe("5th Grade");
    expect(summary.students[0].currentClassroom).toBe("Room 12");
  });

  it("HIDES the placement again after it is withdrawn/unpublished", async () => {
    published("e-next");
    expect((await getPtaParentProgressionSummary(ORG, HOUSEHOLD)).students[0].status).toBe("CONFIRMED");
    // Withdrawal flips the batch out of PUBLISHED, so the join returns nothing.
    published();
    const after = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(after.students[0]).toMatchObject({ nextGrade: null, status: "NOT_YET_AVAILABLE", publicationStatus: "NOT_AVAILABLE" });
  });

  it("HIDES a rolled-back placement (target enrollment goes INACTIVE, filtered at the enrollment query)", async () => {
    findManyEnrollment.mockResolvedValue([enrollment("e-cur", "s-1", "y-cur", "2026-2027", "5th Grade", "Room 12")]);
    published("e-next");
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.students[0].nextGrade).toBeNull();
    expect(findManyEnrollment.mock.calls[0][0].where.status).toBe("ACTIVE");
  });

  it("reflects a correction made after publication (the live enrollment is the source of truth)", async () => {
    findManyEnrollment.mockResolvedValue([
      enrollment("e-cur", "s-1", "y-cur", "2026-2027", "5th Grade", "Room 12"),
      // Corrected placement — same enrollment id, different classroom.
      enrollment("e-next", "s-1", "y-next", "2027-2028", "6th Grade", "Room 33"),
    ]);
    published("e-next");
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.students[0].nextClassroom).toBe("Room 33");
    expect(summary.students[0].status).toBe("CONFIRMED");
  });
});

describe("parent progression — minimal publication access (what can possibly leak)", () => {
  beforeEach(() => {
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    findManyEnrollment.mockResolvedValue([
      enrollment("e-cur", "s-1", "y-cur", "2026-2027", "5th Grade", "Room 12"),
      enrollment("e-next", "s-1", "y-next", "2027-2028", "6th Grade", "Room 20"),
    ]);
    published("e-next");
  });

  it("never queries the progression batch table directly — publication is reached only through the record relation", async () => {
    await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(forbiddenBatchAccess).not.toHaveBeenCalled();
  });

  it("selects ONLY targetEnrollmentId from the progression record — no outcome, reason, mapping or audit field", async () => {
    await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(findManyRecord.mock.calls[0][0].select).toEqual({ targetEnrollmentId: true });
  });

  it("filters on publicationStatus PUBLISHED, organization scope, APPLIED status and real placement outcomes", async () => {
    await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    const where = findManyRecord.mock.calls[0][0].where;
    expect(where.organizationId).toBe(ORG);
    expect(where.status).toBe("APPLIED");
    expect(where.batch).toEqual({ organizationId: ORG, publicationStatus: "PUBLISHED" });
    expect(where.outcome.notIn).toEqual(expect.arrayContaining(["NEEDS_REVIEW", "EXCLUDE"]));
  });

  it("only ever asks about the family's own next-year enrollment ids", async () => {
    await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(findManyRecord.mock.calls[0][0].where.targetEnrollmentId).toEqual({ in: ["e-next"] });
  });

  it("returns no batch id, publication actor, or publication timestamp to the family", async () => {
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    const serialized = JSON.stringify(summary);
    for (const forbidden of [
      "batchId",
      "publishedByUserId",
      "publishIdempotencyKey",
      "commitIdempotencyKey",
      "publicationVersion",
      "exceptionReason",
      "NEEDS_REVIEW",
      "PLANNED",
      "previewedAt",
      "notes",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.keys(summary.students[0]).sort()).toEqual(
      [
        "currentClassroom",
        "currentGrade",
        "displayName",
        "nextClassroom",
        "nextGrade",
        "publicationStatus",
        "status",
        "studentId",
      ].sort()
    );
  });

  it("skips the publication query entirely when the family has no next-year enrollment", async () => {
    findManyEnrollment.mockResolvedValue([enrollment("e-cur", "s-1", "y-cur", "2026-2027", "5th Grade", "Room 12")]);
    await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(findManyRecord).not.toHaveBeenCalled();
  });
});

describe("parent progression — tenant and family scoping", () => {
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
    expect(where.status).toBe("ACTIVE");
  });

  it("a household id from another tenant yields no students rather than leaking", async () => {
    findManyStudent.mockResolvedValue([]);
    const summary = await getPtaParentProgressionSummary(ORG, "household-from-another-org");
    expect(summary.students).toEqual([]);
  });

  it("is bounded — at most four queries regardless of how many children the family has", async () => {
    findManyStudent.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({ id: `s-${i}`, displayName: `Child ${i}` })));
    findManyEnrollment.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => enrollment(`e-${i}`, `s-${i}`, "y-next", "2027-2028", "6th Grade", "Room 1"))
    );
    published();
    await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(findManyYear).toHaveBeenCalledTimes(1);
    expect(findManyStudent).toHaveBeenCalledTimes(1);
    expect(findManyEnrollment).toHaveBeenCalledTimes(1);
    expect(findManyRecord).toHaveBeenCalledTimes(1);
  });
});

describe("parent progression — family shapes and statuses", () => {
  it("handles multiple students with different publication outcomes, in deterministic order", async () => {
    findManyStudent.mockResolvedValue([
      { id: "s-a", displayName: "Ada" },
      { id: "s-b", displayName: "Ben" },
    ]);
    findManyEnrollment.mockResolvedValue([
      enrollment("e-a-cur", "s-a", "y-cur", "2026-2027", "5th Grade", "Room 12"),
      enrollment("e-a-next", "s-a", "y-next", "2027-2028", "6th Grade", "Room 20"),
      enrollment("e-b-cur", "s-b", "y-cur", "2026-2027", "2nd Grade", "Room 4"),
      // Ben also has a committed target enrollment, but it is NOT published.
      enrollment("e-b-next", "s-b", "y-next", "2027-2028", "3rd Grade", "Room 5"),
    ]);
    published("e-a-next");
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.students.map((s) => s.displayName)).toEqual(["Ada", "Ben"]);
    expect(summary.students[0]).toMatchObject({ nextGrade: "6th Grade", status: "CONFIRMED", publicationStatus: "PUBLISHED" });
    // Ben's committed-but-unpublished placement must not leak.
    expect(summary.students[1]).toMatchObject({ nextGrade: null, status: "NOT_YET_AVAILABLE", publicationStatus: "NOT_AVAILABLE" });
    expect(findManyStudent.mock.calls[0][0].orderBy).toEqual([{ displayName: "asc" }, { id: "asc" }]);
  });

  it("reports a student with no current placement at all as not yet available", async () => {
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.students[0]).toMatchObject({ currentGrade: null, status: "NOT_YET_AVAILABLE", publicationStatus: "NOT_AVAILABLE" });
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
    expect(summary.students[0]).toMatchObject({ status: "NOT_YET_AVAILABLE", publicationStatus: "NOT_AVAILABLE" });
  });

  it("reports COMPLETED when the student rolled into the active year and no later year is defined", async () => {
    findManyYear.mockResolvedValue([
      { id: "y-prev", label: "2025-2026", isCurrent: false },
      { id: "y-cur", label: "2026-2027", isCurrent: true },
    ]);
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    findManyEnrollment.mockResolvedValue([
      enrollment("e-prev", "s-1", "y-prev", "2025-2026", "4th Grade", "Room 3"),
      enrollment("e-cur", "s-1", "y-cur", "2026-2027", "5th Grade", "Room 12"),
    ]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.students[0].status).toBe("COMPLETED");
    expect(summary.nextSchoolYear).toBeNull();
  });

  it("reports CURRENT for a first-year student with no prior history and no later year defined", async () => {
    findManyYear.mockResolvedValue([{ id: "y-cur", label: "2026-2027", isCurrent: true }]);
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    findManyEnrollment.mockResolvedValue([enrollment("e-cur", "s-1", "y-cur", "2026-2027", "Kindergarten", "Room 1")]);
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

  it("matches legacy enrollments that carry only the free-text school-year label (null schoolYearId)", async () => {
    findManyStudent.mockResolvedValue([{ id: "s-1", displayName: "Ada" }]);
    findManyEnrollment.mockResolvedValue([
      { id: "e-legacy", studentId: "s-1", schoolYearId: null, schoolYear: "2026-2027", classroom: { name: "Room 9", grade: { name: "1st Grade" } } },
    ]);
    const summary = await getPtaParentProgressionSummary(ORG, HOUSEHOLD);
    expect(summary.students[0].currentGrade).toBe("1st Grade");
  });
});
