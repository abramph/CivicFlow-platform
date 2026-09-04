import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueProfile = vi.fn();
const findFirstYear = vi.fn();
const findFirstBatch = vi.fn();
const findManyBatch = vi.fn();
const createBatch = vi.fn();
const updateBatch = vi.fn();
const findManyEnrollment = vi.fn();
const findFirstEnrollment = vi.fn();
const createEnrollment = vi.fn();
const updateEnrollment = vi.fn();
const findManyGrade = vi.fn();
const findManyClassroom = vi.fn();
const findFirstStudent = vi.fn();
const upsertRecord = vi.fn();
const updateRecord = vi.fn();
const findFirstRecord = vi.fn();
const deleteManyMapping = vi.fn();
const createManyMapping = vi.fn();
const findFirstLedgerEntry = vi.fn();
const transaction = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaProfile: { findUnique: (...a: unknown[]) => findUniqueProfile(...a) },
    ptaSchoolYear: { findFirst: (...a: unknown[]) => findFirstYear(...a) },
    ptaStudentProgressionBatch: {
      findFirst: (...a: unknown[]) => findFirstBatch(...a),
      findMany: (...a: unknown[]) => findManyBatch(...a),
      create: (...a: unknown[]) => createBatch(...a),
      update: (...a: unknown[]) => updateBatch(...a),
    },
    ptaStudentEnrollment: {
      findMany: (...a: unknown[]) => findManyEnrollment(...a),
      findFirst: (...a: unknown[]) => findFirstEnrollment(...a),
      create: (...a: unknown[]) => createEnrollment(...a),
      update: (...a: unknown[]) => updateEnrollment(...a),
    },
    ptaGrade: { findMany: (...a: unknown[]) => findManyGrade(...a) },
    ptaClassroom: { findMany: (...a: unknown[]) => findManyClassroom(...a) },
    ptaStudent: { findFirst: (...a: unknown[]) => findFirstStudent(...a) },
    ptaStudentProgressionRecord: {
      upsert: (...a: unknown[]) => upsertRecord(...a),
      update: (...a: unknown[]) => updateRecord(...a),
      findFirst: (...a: unknown[]) => findFirstRecord(...a),
    },
    ptaProgressionClassroomMapping: {
      deleteMany: (...a: unknown[]) => deleteManyMapping(...a),
      createMany: (...a: unknown[]) => createManyMapping(...a),
    },
    ptaVolunteerLedgerEntry: { findFirst: (...a: unknown[]) => findFirstLedgerEntry(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));
vi.mock("@/lib/env", () => ({ isPtaStudentProgressionPlatformEnabled: vi.fn().mockReturnValue(true) }));

import {
  commitProgressionBatch,
  createProgressionBatch,
  listProgressionBatches,
  generateProgressionPreview,
  getProgressionBatchDetail,
  rollbackProgressionBatch,
  saveProgressionClassroomMappings,
  saveProgressionException,
} from "@/lib/labs/pta/student-progression";
import { isPtaStudentProgressionPlatformEnabled } from "@/lib/env";
import { PtaError } from "@/lib/labs/pta/errors";

const actor = { actorUserId: "u1", actorEmail: "officer@example.org" };
const ORG = "org-1";

const executeRawUnsafe = vi.fn().mockResolvedValue(undefined);

function transactionRunsCallback() {
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      ptaStudentProgressionRecord: { upsert: (...a: unknown[]) => upsertRecord(...a), update: (...a: unknown[]) => updateRecord(...a) },
      ptaStudentProgressionBatch: { update: (...a: unknown[]) => updateBatch(...a) },
      ptaStudentEnrollment: {
        findFirst: (...a: unknown[]) => findFirstEnrollment(...a),
        create: (...a: unknown[]) => createEnrollment(...a),
        update: (...a: unknown[]) => updateEnrollment(...a),
      },
      ptaProgressionClassroomMapping: { deleteMany: (...a: unknown[]) => deleteManyMapping(...a), createMany: (...a: unknown[]) => createManyMapping(...a) },
      // commitProgressionBatch wraps each record's processing in a real
      // SAVEPOINT (see student-progression.ts) so one record's failure can't
      // poison the rest of the transaction -- verified end-to-end against a
      // real Postgres database during the build-26 review pass. This mock
      // just needs to exist and resolve; the actual savepoint semantics are
      // a real-database property, not something a mocked tx can exercise.
      $executeRawUnsafe: (...a: unknown[]) => executeRawUnsafe(...a),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPtaStudentProgressionPlatformEnabled).mockReturnValue(true);
  findUniqueProfile.mockResolvedValue({ studentProgressionEnabled: true });
  transactionRunsCallback();
});

describe("feature-flag gate", () => {
  it("blocks when the platform kill-switch is off, before touching the org flag", async () => {
    vi.mocked(isPtaStudentProgressionPlatformEnabled).mockReturnValue(false);
    await expect(createProgressionBatch({ organizationId: ORG, fromSchoolYearId: "y1", toSchoolYearId: "y2", ...actor })).rejects.toThrow(PtaError);
    expect(findUniqueProfile).not.toHaveBeenCalled();
  });

  it("blocks when the platform switch is on but the org flag is off", async () => {
    findUniqueProfile.mockResolvedValueOnce({ studentProgressionEnabled: false });
    await expect(createProgressionBatch({ organizationId: ORG, fromSchoolYearId: "y1", toSchoolYearId: "y2", ...actor })).rejects.toMatchObject({
      code: "PTA_STUDENT_PROGRESSION_DISABLED",
    });
  });
});

describe("createProgressionBatch", () => {
  it("rejects a same-year transition", async () => {
    await expect(createProgressionBatch({ organizationId: ORG, fromSchoolYearId: "y1", toSchoolYearId: "y1", ...actor })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });

  it("rejects a target year that chronologically precedes the source year", async () => {
    findFirstYear.mockResolvedValueOnce({ id: "y1", label: "2026-2027" }).mockResolvedValueOnce({ id: "y0", label: "2025-2026" });
    await expect(createProgressionBatch({ organizationId: ORG, fromSchoolYearId: "y1", toSchoolYearId: "y0", ...actor })).rejects.toMatchObject({
      code: "PTA_PROGRESSION_INVALID_YEAR_ORDER",
    });
  });

  it("rejects a duplicate batch for an already-used year pair (idempotency at creation)", async () => {
    findFirstYear.mockResolvedValueOnce({ id: "y1", label: "2026-2027" }).mockResolvedValueOnce({ id: "y2", label: "2027-2028" });
    findFirstBatch.mockResolvedValueOnce({ id: "existing-batch" });
    await expect(createProgressionBatch({ organizationId: ORG, fromSchoolYearId: "y1", toSchoolYearId: "y2", ...actor })).rejects.toMatchObject({
      code: "PTA_PROGRESSION_BATCH_ALREADY_EXISTS",
    });
    expect(createBatch).not.toHaveBeenCalled();
  });

  it("creates a batch and audits it", async () => {
    findFirstYear.mockResolvedValueOnce({ id: "y1", label: "2026-2027" }).mockResolvedValueOnce({ id: "y2", label: "2027-2028" });
    findFirstBatch.mockResolvedValueOnce(null);
    createBatch.mockResolvedValueOnce({ id: "batch-1" });

    const batch = await createProgressionBatch({ organizationId: ORG, fromSchoolYearId: "y1", toSchoolYearId: "y2", ...actor });

    expect(batch.id).toBe("batch-1");
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.student_progression.batch_created" }));
  });
});

describe("generateProgressionPreview -- automatic outcome computation", () => {
  const grades = [
    { id: "g1", sortOrder: 1 },
    { id: "g2", sortOrder: 2 },
  ];

  it("promotes a student to the next grade when a classroom mapping exists", async () => {
    findFirstBatch.mockResolvedValueOnce({
      id: "batch-1",
      fromSchoolYearId: "y1",
      toSchoolYearId: "y2",
      status: "PREPARING",
      preparedByUserId: "u1",
      records: [],
      classroomMappings: [{ sourceClassroomId: "c1", targetClassroomId: "c2" }],
    });
    findManyEnrollment.mockResolvedValueOnce([
      { id: "e1", studentId: "s1", classroomId: "c1", classroom: { id: "c1", grade: grades[0] } },
    ]);
    findManyGrade.mockResolvedValueOnce(grades);
    findManyEnrollment.mockResolvedValueOnce([]); // existing target-year enrollments
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "PREVIEWED", records: [] }); // final getProgressionBatchDetail() lookup

    await generateProgressionPreview(ORG, "batch-1");

    expect(upsertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ outcome: "PROMOTE", targetGradeId: "g2", targetClassroomId: "c2" }),
      })
    );
    expect(updateBatch).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PREVIEWED" }) }));
  });

  it("marks a student in the highest-sortOrder grade as GRADUATE, with no target classroom needed", async () => {
    findFirstBatch.mockResolvedValueOnce({
      id: "batch-1",
      fromSchoolYearId: "y1",
      toSchoolYearId: "y2",
      status: "PREPARING",
      preparedByUserId: "u1",
      records: [],
      classroomMappings: [],
    });
    findManyEnrollment.mockResolvedValueOnce([
      { id: "e1", studentId: "s1", classroomId: "c1", classroom: { id: "c1", grade: grades[1] } }, // already at the highest grade
    ]);
    findManyGrade.mockResolvedValueOnce(grades);
    findManyEnrollment.mockResolvedValueOnce([]);
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "PREVIEWED", records: [] });

    await generateProgressionPreview(ORG, "batch-1");

    expect(upsertRecord).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ outcome: "GRADUATE", targetGradeId: null }) }));
  });

  it("marks a student NEEDS_REVIEW when a next grade exists but no classroom mapping was configured -- never guesses", async () => {
    findFirstBatch.mockResolvedValueOnce({
      id: "batch-1",
      fromSchoolYearId: "y1",
      toSchoolYearId: "y2",
      status: "PREPARING",
      preparedByUserId: "u1",
      records: [],
      classroomMappings: [], // no mapping configured for c1
    });
    findManyEnrollment.mockResolvedValueOnce([{ id: "e1", studentId: "s1", classroomId: "c1", classroom: { id: "c1", grade: grades[0] } }]);
    findManyGrade.mockResolvedValueOnce(grades);
    findManyEnrollment.mockResolvedValueOnce([]);
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "PREVIEWED", records: [] });

    await generateProgressionPreview(ORG, "batch-1");

    expect(upsertRecord).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ outcome: "NEEDS_REVIEW", targetGradeId: "g2", targetClassroomId: null }) }));
  });

  it("re-running preview NEVER overwrites a student who already has an admin-set exception (RETAIN/TRANSFER/WITHDRAW/EXCLUDE/MANUAL)", async () => {
    findFirstBatch.mockResolvedValueOnce({
      id: "batch-1",
      fromSchoolYearId: "y1",
      toSchoolYearId: "y2",
      status: "PREVIEWED",
      preparedByUserId: "u1",
      records: [{ id: "r1", studentId: "s1", outcome: "WITHDRAW" }], // admin already set this
      classroomMappings: [{ sourceClassroomId: "c1", targetClassroomId: "c2" }],
    });
    findManyEnrollment.mockResolvedValueOnce([{ id: "e1", studentId: "s1", classroomId: "c1", classroom: { id: "c1", grade: grades[0] } }]);
    findManyGrade.mockResolvedValueOnce(grades);
    findManyEnrollment.mockResolvedValueOnce([]);
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "PREVIEWED", records: [] });

    await generateProgressionPreview(ORG, "batch-1");

    expect(upsertRecord).not.toHaveBeenCalled();
  });

  it("dry-run preview writes no PtaStudentEnrollment rows -- only PtaStudentProgressionRecord upserts", async () => {
    findFirstBatch.mockResolvedValueOnce({
      id: "batch-1",
      fromSchoolYearId: "y1",
      toSchoolYearId: "y2",
      status: "PREPARING",
      preparedByUserId: "u1",
      records: [],
      classroomMappings: [{ sourceClassroomId: "c1", targetClassroomId: "c2" }],
    });
    findManyEnrollment.mockResolvedValueOnce([{ id: "e1", studentId: "s1", classroomId: "c1", classroom: { id: "c1", grade: grades[0] } }]);
    findManyGrade.mockResolvedValueOnce(grades);
    findManyEnrollment.mockResolvedValueOnce([]);
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "PREVIEWED", records: [] });

    await generateProgressionPreview(ORG, "batch-1");

    expect(createEnrollment).not.toHaveBeenCalled();
  });

  it("refuses to preview an already-committed batch", async () => {
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "COMMITTED", classroomMappings: [], records: [] });
    await expect(generateProgressionPreview(ORG, "batch-1")).rejects.toMatchObject({ code: "PTA_PROGRESSION_BATCH_NOT_CORRECTABLE" });
  });
});

describe("saveProgressionException", () => {
  it("saves a RETAIN exception for a student", async () => {
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "PREVIEWED", fromSchoolYearId: "y1" });
    findFirstStudent.mockResolvedValueOnce({ id: "s1" });
    findFirstEnrollment.mockResolvedValueOnce({ id: "e1", classroomId: "c1" });
    upsertRecord.mockResolvedValueOnce({ id: "r1", outcome: "RETAIN" });

    const record = await saveProgressionException({
      organizationId: ORG,
      batchId: "batch-1",
      studentId: "s1",
      outcome: "RETAIN",
      targetGradeId: "g1",
      targetClassroomId: "c1-new",
      ...actor,
    });

    expect(record.outcome).toBe("RETAIN");
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.student_progression.exception_saved" }));
  });

  it("refuses exceptions on an already-committed batch", async () => {
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "COMMITTED" });
    await expect(
      saveProgressionException({ organizationId: ORG, batchId: "batch-1", studentId: "s1", outcome: "WITHDRAW", ...actor })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_BATCH_NOT_CORRECTABLE" });
  });
});

describe("commitProgressionBatch", () => {
  const PREVIEW_TIME = new Date("2027-06-01T00:00:00Z");

  function batchWithRecords(records: Record<string, unknown>[]) {
    return {
      id: "batch-1",
      organizationId: ORG,
      status: "PREVIEWED",
      previewedAt: PREVIEW_TIME,
      toSchoolYearId: "y2",
      toSchoolYear: { id: "y2", label: "2027-2028" },
      records,
    };
  }

  it("requires a preview before committing", async () => {
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "PREPARING", records: [] });
    await expect(
      commitProgressionBatch({ organizationId: ORG, batchId: "batch-1", previewVersion: PREVIEW_TIME.toISOString(), idempotencyKey: "k1", ...actor })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_BATCH_NOT_PREVIEWED" });
  });

  it("rejects a stale preview version (regenerated since the caller last fetched it)", async () => {
    findFirstBatch.mockResolvedValueOnce(batchWithRecords([]));
    await expect(
      commitProgressionBatch({ organizationId: ORG, batchId: "batch-1", previewVersion: new Date("2020-01-01").toISOString(), idempotencyKey: "k1", ...actor })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_BATCH_STALE_PREVIEW" });
  });

  it("promotes a PROMOTE record by creating a new target-year enrollment", async () => {
    findFirstBatch.mockResolvedValueOnce(
      batchWithRecords([{ id: "r1", studentId: "s1", outcome: "PROMOTE", targetGradeId: "g2", targetClassroomId: "c2" }])
    );
    findFirstEnrollment.mockResolvedValueOnce(null); // no existing target-year enrollment
    createEnrollment.mockResolvedValueOnce({ id: "new-enrollment" });
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "COMMITTED", records: [] }); // final getProgressionBatchDetail() lookup

    const result = await commitProgressionBatch({ organizationId: ORG, batchId: "batch-1", previewVersion: PREVIEW_TIME.toISOString(), idempotencyKey: "k1", ...actor });

    expect(createEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ studentId: "s1", classroomId: "c2", schoolYearId: "y2", status: "ACTIVE" }) })
    );
    expect(result.promoted).toBe(1);
    expect(updateBatch).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMMITTED", commitIdempotencyKey: "k1" }) }));
  });

  it("is idempotent against an existing target-year enrollment (student already enrolled ahead of the batch) -- reuses it, never a duplicate", async () => {
    findFirstBatch.mockResolvedValueOnce(
      batchWithRecords([{ id: "r1", studentId: "s1", outcome: "PROMOTE", targetGradeId: "g2", targetClassroomId: "c2" }])
    );
    findFirstEnrollment.mockResolvedValueOnce({ id: "already-there", status: "ACTIVE", classroomId: "c2" });
    updateEnrollment.mockResolvedValueOnce({ id: "already-there" });
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "COMMITTED", records: [] });

    const result = await commitProgressionBatch({ organizationId: ORG, batchId: "batch-1", previewVersion: PREVIEW_TIME.toISOString(), idempotencyKey: "k1", ...actor });

    expect(createEnrollment).not.toHaveBeenCalled();
    // Reuse now re-asserts this commit's own placement rather than
    // inheriting whatever state the row was in -- a rolled-back attempt
    // leaves its enrollments INACTIVE, and families only ever see ACTIVE
    // ones. See the "reusing a target-year enrollment" suite.
    expect(updateEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "already-there" }, data: expect.objectContaining({ status: "ACTIVE", classroomId: "c2" }) })
    );
    expect(result.promoted).toBe(1);
  });

  it("marks GRADUATE records applied with no enrollment created", async () => {
    findFirstBatch.mockResolvedValueOnce(batchWithRecords([{ id: "r1", studentId: "s1", outcome: "GRADUATE", targetGradeId: null, targetClassroomId: null }]));
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "COMMITTED", records: [] });
    const result = await commitProgressionBatch({ organizationId: ORG, batchId: "batch-1", previewVersion: PREVIEW_TIME.toISOString(), idempotencyKey: "k1", ...actor });
    expect(createEnrollment).not.toHaveBeenCalled();
    expect(result.graduated).toBe(1);
  });

  it("marks TRANSFER and WITHDRAW records applied with no enrollment", async () => {
    findFirstBatch.mockResolvedValueOnce(
      batchWithRecords([
        { id: "r1", studentId: "s1", outcome: "TRANSFER", targetGradeId: null, targetClassroomId: null },
        { id: "r2", studentId: "s2", outcome: "WITHDRAW", targetGradeId: null, targetClassroomId: null },
      ])
    );
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "COMMITTED", records: [] });
    const result = await commitProgressionBatch({ organizationId: ORG, batchId: "batch-1", previewVersion: PREVIEW_TIME.toISOString(), idempotencyKey: "k1", ...actor });
    expect(result.transferred).toBe(1);
    expect(result.withdrawn).toBe(1);
    expect(createEnrollment).not.toHaveBeenCalled();
  });

  it("skips EXCLUDE and NEEDS_REVIEW records without creating anything", async () => {
    findFirstBatch.mockResolvedValueOnce(
      batchWithRecords([
        { id: "r1", studentId: "s1", outcome: "EXCLUDE", targetGradeId: null, targetClassroomId: null },
        { id: "r2", studentId: "s2", outcome: "NEEDS_REVIEW", targetGradeId: "g2", targetClassroomId: null },
      ])
    );
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "COMMITTED", records: [] });
    const result = await commitProgressionBatch({ organizationId: ORG, batchId: "batch-1", previewVersion: PREVIEW_TIME.toISOString(), idempotencyKey: "k1", ...actor });
    expect(result.skipped).toBe(2);
    expect(createEnrollment).not.toHaveBeenCalled();
  });

  it("handles two students from one family progressing differently in the same commit", async () => {
    findFirstBatch.mockResolvedValueOnce(
      batchWithRecords([
        { id: "r1", studentId: "s1", outcome: "PROMOTE", targetGradeId: "g2", targetClassroomId: "c2" },
        { id: "r2", studentId: "s2", outcome: "GRADUATE", targetGradeId: null, targetClassroomId: null },
      ])
    );
    findFirstEnrollment.mockResolvedValueOnce(null);
    createEnrollment.mockResolvedValueOnce({ id: "e-new" });
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "COMMITTED", records: [] });

    const result = await commitProgressionBatch({ organizationId: ORG, batchId: "batch-1", previewVersion: PREVIEW_TIME.toISOString(), idempotencyKey: "k1", ...actor });

    expect(result.promoted).toBe(1);
    expect(result.graduated).toBe(1);
  });

  it("isolates one record's failure via a SAVEPOINT -- the rest of the batch still commits, and the batch itself is not aborted", async () => {
    // Regression test for a real defect found during the build-26 review:
    // Postgres aborts the ENTIRE surrounding transaction after any error,
    // even one caught in application code -- verified end-to-end against a
    // real database that without a per-record SAVEPOINT, a single
    // constraint violation on one student's enrollment silently rolled back
    // every other student's progression in the same commit, surfacing only
    // as an unhandled error rather than one FAILED record.
    findFirstBatch.mockResolvedValueOnce(
      batchWithRecords([
        { id: "r1", studentId: "s1", outcome: "PROMOTE", targetGradeId: "g2", targetClassroomId: "c2" },
        { id: "r2", studentId: "s2", outcome: "PROMOTE", targetGradeId: "g2", targetClassroomId: "c2" },
      ])
    );
    findFirstEnrollment.mockResolvedValueOnce(null); // r1: no existing target enrollment
    createEnrollment.mockRejectedValueOnce(new Error("Unique constraint failed on the fields: (`studentId`,`schoolYear`)")); // r1's create fails
    findFirstEnrollment.mockResolvedValueOnce(null); // r2: no existing target enrollment
    createEnrollment.mockResolvedValueOnce({ id: "e-r2" }); // r2's create succeeds
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "COMMITTED", records: [] });

    const result = await commitProgressionBatch({ organizationId: ORG, batchId: "batch-1", previewVersion: PREVIEW_TIME.toISOString(), idempotencyKey: "k1", ...actor });

    // r1 failed cleanly and was marked FAILED with the real error recorded.
    expect(updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1" }, data: expect.objectContaining({ status: "FAILED", exceptionReason: expect.stringContaining("Unique constraint") }) })
    );
    // r2 still succeeded in the SAME commit.
    expect(updateRecord).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r2" }, data: expect.objectContaining({ status: "APPLIED", targetEnrollmentId: "e-r2" }) }));
    expect(result.failed).toBe(1);
    expect(result.promoted).toBe(1);
    // The batch itself still committed -- one record's failure did not
    // abort the whole commit or leave the batch stuck at PREVIEWED.
    expect(updateBatch).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMMITTED" }) }));
    // A savepoint was taken and either released or rolled back for each record.
    expect(executeRawUnsafe.mock.calls.filter((c) => String(c[0]).startsWith("SAVEPOINT")).length).toBe(2);
    expect(executeRawUnsafe.mock.calls.some((c) => String(c[0]).startsWith("ROLLBACK TO SAVEPOINT"))).toBe(true);
  });

  it("a retried commit with the SAME idempotency key against an already-COMMITTED batch returns the prior result without re-applying", async () => {
    findFirstBatch.mockResolvedValueOnce({
      id: "batch-1",
      status: "COMMITTED",
      commitIdempotencyKey: "k1",
    });
    findFirstBatch.mockResolvedValueOnce({
      // getProgressionBatchDetail's own lookup
      id: "batch-1",
      status: "COMMITTED",
      records: [{ id: "r1", studentId: "s1", outcome: "PROMOTE", status: "APPLIED" }],
    });

    const result = await commitProgressionBatch({ organizationId: ORG, batchId: "batch-1", previewVersion: PREVIEW_TIME.toISOString(), idempotencyKey: "k1", ...actor });

    expect(result.promoted).toBe(1);
    expect(createEnrollment).not.toHaveBeenCalled();
    expect(updateBatch).not.toHaveBeenCalled();
  });

  it("a DIFFERENT idempotency key against an already-COMMITTED batch is rejected as a genuinely new attempt", async () => {
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "COMMITTED", commitIdempotencyKey: "k1" });
    await expect(
      commitProgressionBatch({ organizationId: ORG, batchId: "batch-1", previewVersion: PREVIEW_TIME.toISOString(), idempotencyKey: "k2", ...actor })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_BATCH_ALREADY_COMMITTED" });
  });
});

describe("rollbackProgressionBatch — publication interaction", () => {
  it("BLOCKS rollback while results are still published to families", async () => {
    findFirstBatch.mockResolvedValueOnce({
      id: "batch-1",
      status: "COMMITTED",
      publicationStatus: "PUBLISHED",
      committedAt: new Date("2027-06-01"),
      records: [{ id: "r1", studentId: "s1", targetEnrollmentId: "e1", student: { householdId: "h1" } }],
    });

    await expect(rollbackProgressionBatch({ organizationId: ORG, batchId: "batch-1", ...actor })).rejects.toMatchObject({
      code: "PTA_PROGRESSION_ROLLBACK_BLOCKED_PUBLISHED",
    });
    // Nothing was touched -- the disclosure must be withdrawn explicitly first.
    expect(transaction).not.toHaveBeenCalled();
  });

  it("allows rollback once the results have been withdrawn", async () => {
    findFirstBatch.mockResolvedValueOnce({
      id: "batch-1",
      status: "COMMITTED",
      publicationStatus: "WITHDRAWN",
      committedAt: new Date("2027-06-01"),
      records: [{ id: "r1", studentId: "s1", targetEnrollmentId: "e1", student: { householdId: "h1" } }],
    });
    findFirstLedgerEntry.mockResolvedValueOnce(null);
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "ROLLED_BACK", records: [] });

    await expect(rollbackProgressionBatch({ organizationId: ORG, batchId: "batch-1", ...actor })).resolves.toBeTruthy();
    expect(transaction).toHaveBeenCalled();
  });

  it("allows rollback of a never-published committed batch", async () => {
    findFirstBatch.mockResolvedValueOnce({
      id: "batch-1",
      status: "COMMITTED",
      publicationStatus: "UNPUBLISHED",
      committedAt: new Date("2027-06-01"),
      records: [{ id: "r1", studentId: "s1", targetEnrollmentId: "e1", student: { householdId: "h1" } }],
    });
    findFirstLedgerEntry.mockResolvedValueOnce(null);
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "ROLLED_BACK", records: [] });

    await expect(rollbackProgressionBatch({ organizationId: ORG, batchId: "batch-1", ...actor })).resolves.toBeTruthy();
  });
});

describe("rollbackProgressionBatch", () => {
  it("rolls back a committed batch with no dependent activity", async () => {
    findFirstBatch.mockResolvedValueOnce({
      id: "batch-1",
      status: "COMMITTED",
      committedAt: new Date("2027-06-01"),
      records: [{ id: "r1", studentId: "s1", targetEnrollmentId: "e1", student: { householdId: "h1" } }],
    });
    findFirstLedgerEntry.mockResolvedValueOnce(null);
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "ROLLED_BACK", records: [] });

    await rollbackProgressionBatch({ organizationId: ORG, batchId: "batch-1", ...actor });

    expect(updateEnrollment).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "e1" }, data: { status: "INACTIVE" } }));
    expect(updateBatch).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ROLLED_BACK" }) }));
  });

  it("blocks rollback when a target-year household already has dependent volunteer-ledger activity", async () => {
    findFirstBatch.mockResolvedValueOnce({
      id: "batch-1",
      status: "COMMITTED",
      committedAt: new Date("2027-06-01"),
      records: [{ id: "r1", studentId: "s1", targetEnrollmentId: "e1", student: { householdId: "h1" } }],
    });
    findFirstLedgerEntry.mockResolvedValueOnce({ id: "ledger-1" });

    await expect(rollbackProgressionBatch({ organizationId: ORG, batchId: "batch-1", ...actor })).rejects.toMatchObject({
      code: "PTA_PROGRESSION_ROLLBACK_BLOCKED_DEPENDENT_ACTIVITY",
    });
    expect(updateEnrollment).not.toHaveBeenCalled();
  });

  it("refuses to roll back a batch that was never committed", async () => {
    findFirstBatch.mockResolvedValueOnce({ id: "batch-1", status: "PREVIEWED" });
    await expect(rollbackProgressionBatch({ organizationId: ORG, batchId: "batch-1", ...actor })).rejects.toMatchObject({
      code: "PTA_PROGRESSION_BATCH_NOT_CORRECTABLE",
    });
  });
});

describe("tenant isolation", () => {
  it("getProgressionBatchDetail scopes by organizationId and 404s across tenants", async () => {
    findFirstBatch.mockResolvedValueOnce(null);
    await expect(getProgressionBatchDetail(ORG, "batch-from-other-org")).rejects.toMatchObject({ code: "PTA_PROGRESSION_BATCH_NOT_FOUND" });
    expect(findFirstBatch).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) }));
  });
});

/**
 * Lifecycle immutability. Committed work must never become editable again.
 *
 * These exist because the three editing services originally used a
 * DENYLIST ("reject if COMMITTED or ROLLED_BACK") which silently omitted
 * CORRECTED. Since correctProgressionRecord sets exactly that status, one
 * correction re-opened a committed batch for wholesale editing --
 * reproduced before the fix: a CORRECTED batch's classroom mappings were
 * deleted and recreated with no error raised.
 */
describe("progression lifecycle — committed batches are immutable", () => {
  const NON_EDITABLE = ["COMMITTED", "CORRECTED", "ROLLED_BACK"] as const;

  describe.each(NON_EDITABLE)("a %s batch", (status) => {
    it("rejects classroom-mapping edits and writes nothing", async () => {
      findFirstBatch.mockResolvedValue({ id: "batch-1", status, organizationId: ORG });
      await expect(
        saveProgressionClassroomMappings({
          organizationId: ORG,
          batchId: "batch-1",
          mappings: [{ sourceClassroomId: "c1", targetClassroomId: "c2" }],
          ...actor,
        } as never)
      ).rejects.toMatchObject({ code: "PTA_PROGRESSION_BATCH_NOT_CORRECTABLE" });
      expect(deleteManyMapping).not.toHaveBeenCalled();
      expect(createManyMapping).not.toHaveBeenCalled();
    });

    it("rejects preview regeneration, so committed records cannot be overwritten", async () => {
      findFirstBatch.mockResolvedValue({ id: "batch-1", status, organizationId: ORG, classroomMappings: [], records: [] });
      await expect(generateProgressionPreview(ORG, "batch-1")).rejects.toMatchObject({
        code: "PTA_PROGRESSION_BATCH_NOT_CORRECTABLE",
      });
      expect(transaction).not.toHaveBeenCalled();
    });

    it("rejects per-student exception/override changes", async () => {
      findFirstBatch.mockResolvedValue({ id: "batch-1", status, organizationId: ORG });
      await expect(
        saveProgressionException({ organizationId: ORG, batchId: "batch-1", studentId: "s1", outcome: "RETAIN", ...actor } as never)
      ).rejects.toMatchObject({ code: "PTA_PROGRESSION_BATCH_NOT_CORRECTABLE" });
      expect(upsertRecord).not.toHaveBeenCalled();
    });
  });

  it("a PUBLISHED batch is not editable even if some future status were considered editable", async () => {
    // Defence in depth: publication is checked independently of status.
    findFirstBatch.mockResolvedValue({ id: "batch-1", status: "PREVIEWED", publicationStatus: "PUBLISHED", organizationId: ORG });
    await expect(
      saveProgressionClassroomMappings({
        organizationId: ORG,
        batchId: "batch-1",
        mappings: [{ sourceClassroomId: "c1", targetClassroomId: "c2" }],
        ...actor,
      } as never)
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_BATCH_NOT_CORRECTABLE" });
    expect(deleteManyMapping).not.toHaveBeenCalled();
  });

  describe.each(["PREPARING", "PREVIEWED"] as const)("a %s batch remains editable", (status) => {
    it("allows classroom-mapping edits", async () => {
      findFirstBatch.mockResolvedValue({ id: "batch-1", status, organizationId: ORG });
      findManyClassroom.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
      await expect(
        saveProgressionClassroomMappings({
          organizationId: ORG,
          batchId: "batch-1",
          mappings: [{ sourceClassroomId: "c1", targetClassroomId: "c2" }],
          ...actor,
        } as never)
      ).resolves.toBeTruthy();
      expect(createManyMapping).toHaveBeenCalled();
    });
  });

  it("a cross-organization batch id is not found, so no state check can be bypassed", async () => {
    findFirstBatch.mockResolvedValue(null);
    await expect(
      saveProgressionClassroomMappings({ organizationId: ORG, batchId: "other-org-batch", mappings: [], ...actor } as never)
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_BATCH_NOT_FOUND" });
  });
});

/**
 * Rerun-after-rollback (Build 26 remediation).
 *
 * The original design put an unconditional unique index on
 * (organizationId, fromSchoolYearId, toSchoolYearId), which made rollback a
 * dead end -- the rolled-back batch kept occupying the year pair forever.
 * These cover the service half of the fix. Per-status conflict behaviour, the
 * partial index itself and true concurrency are proven against a real
 * PostgreSQL database by scripts/verify-progression-constraint.mjs, which the
 * Migrations CI job runs; a mocked Prisma cannot enforce an index.
 */
describe("progression rerun after rollback", () => {
  const years = () =>
    findFirstYear.mockResolvedValueOnce({ id: "y1", label: "2026-2027" }).mockResolvedValueOnce({ id: "y2", label: "2027-2028" });

  it("only a NON-rolled-back batch blocks a new attempt (the query excludes ROLLED_BACK)", async () => {
    years();
    findFirstBatch.mockResolvedValueOnce(null);
    createBatch.mockResolvedValueOnce({ id: "batch-2" });

    await createProgressionBatch({ organizationId: ORG, fromSchoolYearId: "y1", toSchoolYearId: "y2", ...actor });

    expect(findFirstBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG,
          fromSchoolYearId: "y1",
          toSchoolYearId: "y2",
          status: { not: "ROLLED_BACK" },
        }),
      })
    );
  });

  it("creates a second attempt with a distinct id once the first was rolled back", async () => {
    years();
    findFirstBatch.mockResolvedValueOnce(null); // the rolled-back attempt is filtered out
    createBatch.mockResolvedValueOnce({ id: "batch-2" });

    const batch = await createProgressionBatch({ organizationId: ORG, fromSchoolYearId: "y1", toSchoolYearId: "y2", ...actor });

    expect(batch.id).toBe("batch-2");
    expect(createBatch).toHaveBeenCalledOnce();
  });

  it("still refuses a second attempt while one is active", async () => {
    years();
    findFirstBatch.mockResolvedValueOnce({ id: "active-batch" });

    await expect(
      createProgressionBatch({ organizationId: ORG, fromSchoolYearId: "y1", toSchoolYearId: "y2", ...actor })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_BATCH_ALREADY_EXISTS" });
    expect(createBatch).not.toHaveBeenCalled();
  });

  it("no longer advises rolling back a batch that may already be rolled back", async () => {
    years();
    findFirstBatch.mockResolvedValueOnce({ id: "active-batch" });

    const error = await createProgressionBatch({ organizationId: ORG, fromSchoolYearId: "y1", toSchoolYearId: "y2", ...actor }).catch(
      (e: Error) => e
    );

    expect(error).toBeInstanceOf(PtaError);
    expect((error as Error).message).toMatch(/already in progress/i);
    // The old copy said "roll it back rather than starting a new one", which
    // is the one action that cannot resolve this conflict.
    expect((error as Error).message).not.toMatch(/rather than starting a new one/i);
    expect((error as Error).message).toMatch(/fresh attempt/i);
  });

  it("translates a lost create race (partial-index P2002) into the same deterministic conflict", async () => {
    years();
    findFirstBatch.mockResolvedValueOnce(null); // pre-check passed, then another writer won
    createBatch.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["PtaStudentProgressionBatch_active_transition_key"] },
      })
    );

    await expect(
      createProgressionBatch({ organizationId: ORG, fromSchoolYearId: "y1", toSchoolYearId: "y2", ...actor })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_BATCH_ALREADY_EXISTS" });
  });

  it("does not swallow an unrelated unique violation as a transition conflict", async () => {
    years();
    findFirstBatch.mockResolvedValueOnce(null);
    createBatch.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["PtaStudentProgressionBatch_commitIdempotencyKey_key"] },
      })
    );

    await expect(
      createProgressionBatch({ organizationId: ORG, fromSchoolYearId: "y1", toSchoolYearId: "y2", ...actor })
    ).rejects.not.toMatchObject({ code: "PTA_PROGRESSION_BATCH_ALREADY_EXISTS" });
  });

  it("history lists every attempt, newest first, so a rolled-back one stays queryable", async () => {
    findManyBatch.mockResolvedValueOnce([{ id: "batch-2" }, { id: "batch-1" }]);

    const all = await listProgressionBatches(ORG);

    expect(all.map((b: { id: string }) => b.id)).toEqual(["batch-2", "batch-1"]);
    expect(findManyBatch).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG }, orderBy: { createdAt: "desc" } })
    );
  });
});

/**
 * D1b: committing a fresh attempt must re-assert its own placement.
 *
 * rollbackProgressionBatch sets its target enrollments INACTIVE rather than
 * deleting them, and getParentProgression only ever shows ACTIVE enrollments.
 * Before this fix the commit path reused an existing target-year enrollment
 * verbatim, so a second attempt committed "successfully" while every family
 * still saw nothing -- and kept the first attempt's classroom.
 */
describe("commitProgressionBatch — reusing a target-year enrollment", () => {
  const PREVIEW_TIME = new Date("2027-06-01T00:00:00Z");
  const previewed = (records: Record<string, unknown>[]) => ({
    id: "batch-2",
    organizationId: ORG,
    status: "PREVIEWED",
    previewedAt: PREVIEW_TIME,
    toSchoolYearId: "y2",
    toSchoolYear: { id: "y2", label: "2027-2028" },
    records,
  });

  it("reactivates and retargets an INACTIVE enrollment left behind by a rolled-back attempt", async () => {
    findFirstBatch.mockResolvedValueOnce(
      previewed([{ id: "r1", studentId: "s1", outcome: "PROMOTE", targetGradeId: "g2", targetClassroomId: "c-new" }])
    );
    // left over from attempt one: INACTIVE, and pointing at the OLD classroom
    findFirstEnrollment.mockResolvedValueOnce({ id: "stale-enrollment", status: "INACTIVE", classroomId: "c-old" });
    updateEnrollment.mockResolvedValueOnce({ id: "stale-enrollment" });
    findFirstBatch.mockResolvedValueOnce({ id: "batch-2", status: "COMMITTED", records: [] });

    const result = await commitProgressionBatch({
      organizationId: ORG, batchId: "batch-2", previewVersion: PREVIEW_TIME.toISOString(), idempotencyKey: "k2", ...actor,
    });

    expect(updateEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "stale-enrollment" },
        data: expect.objectContaining({ status: "ACTIVE", classroomId: "c-new" }),
      })
    );
    expect(createEnrollment).not.toHaveBeenCalled();
    expect(result.promoted).toBe(1);
  });

  it("still creates a fresh enrollment when the student has none for the target year", async () => {
    findFirstBatch.mockResolvedValueOnce(
      previewed([{ id: "r1", studentId: "s1", outcome: "PROMOTE", targetGradeId: "g2", targetClassroomId: "c2" }])
    );
    findFirstEnrollment.mockResolvedValueOnce(null);
    createEnrollment.mockResolvedValueOnce({ id: "new-enrollment" });
    findFirstBatch.mockResolvedValueOnce({ id: "batch-2", status: "COMMITTED", records: [] });

    await commitProgressionBatch({
      organizationId: ORG, batchId: "batch-2", previewVersion: PREVIEW_TIME.toISOString(), idempotencyKey: "k3", ...actor,
    });

    expect(createEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ classroomId: "c2", status: "ACTIVE" }) })
    );
    expect(updateEnrollment).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ACTIVE", classroomId: "c2" }) })
    );
  });
});
