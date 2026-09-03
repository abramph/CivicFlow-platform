import type { PtaStudentProgressionOutcome } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { isPtaStudentProgressionPlatformEnabled } from "@/lib/env";
import { PtaError } from "./errors";
import { parseSchoolYearLabel } from "./school-years";

/**
 * PTA/PTO Academic-Year Student Progression. The student — not the family —
 * is the unit that progresses: this module creates a new, year-scoped
 * PtaStudentEnrollment row per promoted/retained student, never mutates or
 * deletes the source year's enrollment, and never touches PtaHousehold,
 * PtaHouseholdAdult, or the student's own identity row. Mirrors
 * transitions.ts's shape (the closest existing "year rollover" pattern in
 * this codebase) — a batch record per fromYear->toYear rollover, guarded
 * commit ceremony, audit on every step — adapted for students instead of
 * board officers.
 *
 * The two-flag gate (platform kill-switch + org flag) mirrors the
 * volunteer-hours program's precedent exactly; see
 * isPtaStudentProgressionPlatformEnabled's own doc comment for why this
 * feature gates preview too, not only commit.
 */

interface ActorInput {
  actorUserId: string;
  actorEmail?: string | null;
}

async function assertProgressionEnabled(organizationId: string): Promise<void> {
  if (!isPtaStudentProgressionPlatformEnabled()) {
    throw new PtaError("PTA_STUDENT_PROGRESSION_PLATFORM_DISABLED", "Student progression is not enabled on this platform.");
  }
  const profile = await prisma.ptaProfile.findUnique({ where: { organizationId }, select: { studentProgressionEnabled: true } });
  if (!profile?.studentProgressionEnabled) {
    throw new PtaError("PTA_STUDENT_PROGRESSION_DISABLED", "Student progression has not been turned on for this organization.");
  }
}

function assertChronologicalOrder(fromLabel: string, toLabel: string): void {
  const from = parseSchoolYearLabel(fromLabel);
  const to = parseSchoolYearLabel(toLabel);
  // Non-canonical labels (custom/legacy names) can't be compared
  // numerically — allow them through rather than false-rejecting; the
  // duplicate-year-pair and same-year checks still apply regardless.
  if (!from || !to) return;
  if (to.startYear <= from.startYear) {
    throw new PtaError("PTA_PROGRESSION_INVALID_YEAR_ORDER", "The target school year must come after the source school year.");
  }
}

export async function listProgressionBatches(organizationId: string) {
  await assertProgressionEnabled(organizationId);
  return prisma.ptaStudentProgressionBatch.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      fromSchoolYear: { select: { id: true, label: true } },
      toSchoolYear: { select: { id: true, label: true } },
      records: { select: { id: true, outcome: true, status: true } },
    },
  });
}

export interface CreateProgressionBatchInput extends ActorInput {
  organizationId: string;
  fromSchoolYearId: string;
  toSchoolYearId: string;
  notes?: string | null;
}

export async function createProgressionBatch(input: CreateProgressionBatchInput) {
  await assertProgressionEnabled(input.organizationId);

  if (input.fromSchoolYearId === input.toSchoolYearId) {
    throw new PtaError("PTA_VALIDATION_ERROR", "A progression batch must move to a different school year.");
  }

  const [fromYear, toYear] = await Promise.all([
    prisma.ptaSchoolYear.findFirst({ where: { id: input.fromSchoolYearId, organizationId: input.organizationId } }),
    prisma.ptaSchoolYear.findFirst({ where: { id: input.toSchoolYearId, organizationId: input.organizationId } }),
  ]);
  if (!fromYear) throw new PtaError("PTA_SCHOOL_YEAR_NOT_FOUND", "Source school year not found.");
  if (!toYear) throw new PtaError("PTA_SCHOOL_YEAR_NOT_FOUND", "Target school year not found.");

  assertChronologicalOrder(fromYear.label, toYear.label);

  const existing = await prisma.ptaStudentProgressionBatch.findFirst({
    where: { organizationId: input.organizationId, fromSchoolYearId: fromYear.id, toSchoolYearId: toYear.id },
  });
  if (existing) {
    throw new PtaError(
      "PTA_PROGRESSION_BATCH_ALREADY_EXISTS",
      `A progression batch between ${fromYear.label} and ${toYear.label} already exists. Open it to review, correct, or roll it back rather than starting a new one.`
    );
  }

  const batch = await prisma.ptaStudentProgressionBatch.create({
    data: {
      organizationId: input.organizationId,
      fromSchoolYearId: fromYear.id,
      toSchoolYearId: toYear.id,
      notes: input.notes?.trim() || null,
      preparedByUserId: input.actorUserId,
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.student_progression.batch_created",
    entityType: "pta_student_progression_batch",
    entityId: batch.id,
    metadata: { fromYear: fromYear.label, toYear: toYear.label },
  });

  return batch;
}

const BATCH_DETAIL_INCLUDE = {
  fromSchoolYear: { select: { id: true, label: true } },
  toSchoolYear: { select: { id: true, label: true } },
  classroomMappings: true,
  records: {
    orderBy: { createdAt: "asc" as const },
    include: {
      student: { select: { id: true, displayName: true, householdId: true } },
    },
  },
} as const;

export async function getProgressionBatchDetail(organizationId: string, batchId: string) {
  const batch = await prisma.ptaStudentProgressionBatch.findFirst({
    where: { id: batchId, organizationId },
    include: BATCH_DETAIL_INCLUDE,
  });
  if (!batch) throw new PtaError("PTA_PROGRESSION_BATCH_NOT_FOUND", "Progression batch not found.");
  return batch;
}

export interface SaveClassroomMappingsInput extends ActorInput {
  organizationId: string;
  batchId: string;
  mappings: { sourceClassroomId: string; targetClassroomId: string }[];
}

/** Step 2 of the workflow: administrator-configured source->target
 * classroom mapping for THIS batch only (never a standing rule — see the
 * schema doc comment on PtaProgressionClassroomMapping). Replaces the full
 * mapping set each call (simplest correct semantics for a config screen
 * with an explicit Save action) rather than patching individual entries. */
export async function saveProgressionClassroomMappings(input: SaveClassroomMappingsInput) {
  const batch = await prisma.ptaStudentProgressionBatch.findFirst({ where: { id: input.batchId, organizationId: input.organizationId } });
  if (!batch) throw new PtaError("PTA_PROGRESSION_BATCH_NOT_FOUND", "Progression batch not found.");
  if (batch.status === "COMMITTED" || batch.status === "ROLLED_BACK") {
    throw new PtaError("PTA_PROGRESSION_BATCH_NOT_CORRECTABLE", "This batch is already committed — mapping changes no longer apply retroactively.");
  }

  const sourceIds = input.mappings.map((m) => m.sourceClassroomId);
  const targetIds = input.mappings.map((m) => m.targetClassroomId);
  const classrooms = await prisma.ptaClassroom.findMany({
    where: { organizationId: input.organizationId, id: { in: [...sourceIds, ...targetIds] } },
    select: { id: true },
  });
  const validIds = new Set(classrooms.map((c) => c.id));
  for (const mapping of input.mappings) {
    if (!validIds.has(mapping.sourceClassroomId) || !validIds.has(mapping.targetClassroomId)) {
      throw new PtaError("PTA_CLASSROOM_NOT_FOUND", "One or more mapped classrooms were not found in this organization.");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.ptaProgressionClassroomMapping.deleteMany({ where: { batchId: input.batchId, organizationId: input.organizationId } });
    if (input.mappings.length > 0) {
      await tx.ptaProgressionClassroomMapping.createMany({
        data: input.mappings.map((m) => ({
          organizationId: input.organizationId,
          batchId: input.batchId,
          sourceClassroomId: m.sourceClassroomId,
          targetClassroomId: m.targetClassroomId,
        })),
      });
    }
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.student_progression.classroom_mappings_saved",
    entityType: "pta_student_progression_batch",
    entityId: input.batchId,
    metadata: { mappingCount: input.mappings.length },
  });

  return getProgressionBatchDetail(input.organizationId, input.batchId);
}

/** Outcomes the automatic preview algorithm can assign on its own. Every
 * other outcome (RETAIN/TRANSFER/WITHDRAW/EXCLUDE/MANUAL) only ever comes
 * from an explicit admin exception via saveProgressionException — the
 * preview generator never overwrites a record already carrying one of
 * those, so re-running preview after saving exceptions doesn't clobber
 * them. */
const AUTO_COMPUTED_OUTCOMES: readonly PtaStudentProgressionOutcome[] = ["PROMOTE", "GRADUATE", "NEEDS_REVIEW"];

/** Step 3: computes the complete rollover plan and writes it as PLANNED
 * PtaStudentProgressionRecord rows — no PtaStudentEnrollment is created and
 * no source data is touched. Re-runnable: safe to call again after a
 * mapping change to refresh the plan (preserves any saved per-student
 * exceptions). */
export async function generateProgressionPreview(organizationId: string, batchId: string) {
  const batch = await prisma.ptaStudentProgressionBatch.findFirst({
    where: { id: batchId, organizationId },
    include: { fromSchoolYear: true, toSchoolYear: true, classroomMappings: true, records: true },
  });
  if (!batch) throw new PtaError("PTA_PROGRESSION_BATCH_NOT_FOUND", "Progression batch not found.");
  if (batch.status === "COMMITTED" || batch.status === "ROLLED_BACK") {
    throw new PtaError("PTA_PROGRESSION_BATCH_NOT_CORRECTABLE", "This batch is already committed — generate a new batch for further changes.");
  }

  const [sourceEnrollments, grades, existingTargetEnrollments] = await Promise.all([
    prisma.ptaStudentEnrollment.findMany({
      where: { organizationId, schoolYearId: batch.fromSchoolYearId, status: "ACTIVE" },
      include: { classroom: { include: { grade: true } } },
    }),
    prisma.ptaGrade.findMany({ where: { organizationId }, orderBy: { sortOrder: "asc" } }),
    prisma.ptaStudentEnrollment.findMany({
      where: { organizationId, schoolYearId: batch.toSchoolYearId },
      select: { studentId: true },
    }),
  ]);

  const alreadyEnrolledStudentIds = new Set(existingTargetEnrollments.map((e) => e.studentId));
  const mappingBySource = new Map(batch.classroomMappings.map((m) => [m.sourceClassroomId, m.targetClassroomId]));
  const existingRecordByStudent = new Map(batch.records.map((r) => [r.studentId, r]));

  let promoted = 0;
  let graduated = 0;
  let needsReview = 0;
  let alreadyEnrolled = 0;
  const preservedExceptions: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const enrollment of sourceEnrollments) {
      const existingRecord = existingRecordByStudent.get(enrollment.studentId);
      if (existingRecord && !AUTO_COMPUTED_OUTCOMES.includes(existingRecord.outcome)) {
        // An admin already set an explicit exception for this student —
        // never overwritten by re-running the automatic computation.
        preservedExceptions.push(existingRecord.id);
        continue;
      }
      if (alreadyEnrolledStudentIds.has(enrollment.studentId)) {
        alreadyEnrolled += 1;
      }

      const sourceGrade = enrollment.classroom.grade;
      const nextGrade = grades.find((g) => g.sortOrder > sourceGrade.sortOrder);
      const targetClassroomId = mappingBySource.get(enrollment.classroomId) ?? null;

      let outcome: PtaStudentProgressionOutcome;
      let targetGradeId: string | null = null;
      if (!nextGrade) {
        // Highest-sortOrder grade in the org — graduating the program.
        outcome = "GRADUATE";
        graduated += 1;
      } else if (!targetClassroomId) {
        // Grade progression is deterministic; classroom assignment is not
        // — see Section 3's explicit requirement. No guessing.
        outcome = "NEEDS_REVIEW";
        targetGradeId = nextGrade.id;
        needsReview += 1;
      } else {
        outcome = "PROMOTE";
        targetGradeId = nextGrade.id;
        promoted += 1;
      }

      await tx.ptaStudentProgressionRecord.upsert({
        where: { batchId_studentId: { batchId, studentId: enrollment.studentId } },
        create: {
          organizationId,
          batchId,
          studentId: enrollment.studentId,
          sourceEnrollmentId: enrollment.id,
          outcome,
          sourceGradeId: sourceGrade.id,
          targetGradeId,
          sourceClassroomId: enrollment.classroomId,
          targetClassroomId,
          status: "PLANNED",
        },
        update: {
          sourceEnrollmentId: enrollment.id,
          outcome,
          sourceGradeId: sourceGrade.id,
          targetGradeId,
          sourceClassroomId: enrollment.classroomId,
          targetClassroomId,
          status: "PLANNED",
        },
      });
    }

    await tx.ptaStudentProgressionBatch.update({
      where: { id: batchId },
      data: { status: "PREVIEWED", previewedAt: new Date() },
    });
  });

  await createAuditEvent({
    organizationId,
    actorUserId: batch.preparedByUserId ?? "system",
    action: "pta.student_progression.batch_previewed",
    entityType: "pta_student_progression_batch",
    entityId: batchId,
    metadata: { promoted, graduated, needsReview, alreadyEnrolled, preservedExceptions: preservedExceptions.length },
  });

  return getProgressionBatchDetail(organizationId, batchId);
}

export interface SaveProgressionExceptionInput extends ActorInput {
  organizationId: string;
  batchId: string;
  studentId: string;
  outcome: Exclude<PtaStudentProgressionOutcome, "PROMOTE" | "GRADUATE" | "NEEDS_REVIEW">;
  targetGradeId?: string | null;
  targetClassroomId?: string | null;
  exceptionReason?: string | null;
}

/** Step 2/3: an administrator's explicit per-student override (retain,
 * transfer, withdraw, exclude, or a manual grade/classroom assignment).
 * Only ever writes one of the non-automatic outcomes — see
 * AUTO_COMPUTED_OUTCOMES — so a later preview regeneration preserves it. */
export async function saveProgressionException(input: SaveProgressionExceptionInput) {
  const batch = await prisma.ptaStudentProgressionBatch.findFirst({ where: { id: input.batchId, organizationId: input.organizationId } });
  if (!batch) throw new PtaError("PTA_PROGRESSION_BATCH_NOT_FOUND", "Progression batch not found.");
  if (batch.status === "COMMITTED" || batch.status === "ROLLED_BACK") {
    throw new PtaError("PTA_PROGRESSION_BATCH_NOT_CORRECTABLE", "This batch is already committed — use the correction workflow instead.");
  }

  const student = await prisma.ptaStudent.findFirst({ where: { id: input.studentId, organizationId: input.organizationId } });
  if (!student) throw new PtaError("PTA_STUDENT_NOT_FOUND", "Student not found.");

  const sourceEnrollment = await prisma.ptaStudentEnrollment.findFirst({
    where: { organizationId: input.organizationId, studentId: input.studentId, schoolYearId: batch.fromSchoolYearId },
  });

  const record = await prisma.ptaStudentProgressionRecord.upsert({
    where: { batchId_studentId: { batchId: input.batchId, studentId: input.studentId } },
    create: {
      organizationId: input.organizationId,
      batchId: input.batchId,
      studentId: input.studentId,
      sourceEnrollmentId: sourceEnrollment?.id ?? null,
      outcome: input.outcome,
      sourceClassroomId: sourceEnrollment?.classroomId ?? null,
      targetGradeId: input.targetGradeId ?? null,
      targetClassroomId: input.targetClassroomId ?? null,
      exceptionReason: input.exceptionReason?.trim() || null,
      status: "PLANNED",
    },
    update: {
      outcome: input.outcome,
      targetGradeId: input.targetGradeId ?? null,
      targetClassroomId: input.targetClassroomId ?? null,
      exceptionReason: input.exceptionReason?.trim() || null,
      status: "PLANNED",
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.student_progression.exception_saved",
    entityType: "pta_student_progression_record",
    entityId: record.id,
    metadata: { studentId: input.studentId, outcome: input.outcome },
  });

  return record;
}

export interface CommitProgressionBatchInput extends ActorInput {
  organizationId: string;
  batchId: string;
  /** The batch's previewedAt (ISO string) the caller last saw — rejected if
   * the preview has been regenerated since, per Section 4 Step 4's "a fresh
   * preview or a preview version that has not become stale" requirement. */
  previewVersion: string;
  /** Required unique key for this specific commit request (Section 4 Step
   * 4). A retried request carrying the SAME key against an
   * already-COMMITTED batch returns the prior result rather than erroring
   * or double-applying. */
  idempotencyKey: string;
}

export interface CommitProgressionBatchResult {
  batch: Awaited<ReturnType<typeof getProgressionBatchDetail>>;
  promoted: number;
  graduated: number;
  retained: number;
  transferred: number;
  withdrawn: number;
  skipped: number;
  failed: number;
}

/** Step 4/5: the guarded commit ceremony. Server-side revalidation runs
 * immediately before the write — this function alone decides what actually
 * happens, never trusting a client-computed plan. Executes transactionally:
 * a partial failure rolls the whole batch back to its pre-commit state,
 * never a mixed/unexplained result. */
export async function commitProgressionBatch(input: CommitProgressionBatchInput): Promise<CommitProgressionBatchResult> {
  await assertProgressionEnabled(input.organizationId);

  const batch = await prisma.ptaStudentProgressionBatch.findFirst({
    where: { id: input.batchId, organizationId: input.organizationId },
    include: { toSchoolYear: true, records: true },
  });
  if (!batch) throw new PtaError("PTA_PROGRESSION_BATCH_NOT_FOUND", "Progression batch not found.");

  if (batch.status === "COMMITTED") {
    if (batch.commitIdempotencyKey === input.idempotencyKey) {
      // Safe replay of the exact same commit request — return the
      // already-applied result rather than erroring or re-applying.
      return summarizeCommittedBatch(await getProgressionBatchDetail(input.organizationId, input.batchId));
    }
    throw new PtaError("PTA_PROGRESSION_BATCH_ALREADY_COMMITTED", "This progression batch has already been committed.");
  }
  if (batch.status !== "PREVIEWED") {
    throw new PtaError("PTA_PROGRESSION_BATCH_NOT_PREVIEWED", "Generate a preview before committing this batch.");
  }
  if (!batch.previewedAt || batch.previewedAt.toISOString() !== input.previewVersion) {
    throw new PtaError("PTA_PROGRESSION_BATCH_STALE_PREVIEW", "This preview is out of date — refresh it and confirm again before committing.");
  }

  let promoted = 0;
  let graduated = 0;
  let retained = 0;
  let transferred = 0;
  let withdrawn = 0;
  let skipped = 0;
  let failed = 0;

  await prisma.$transaction(async (tx) => {
    for (const record of batch.records) {
      try {
        if (record.outcome === "NEEDS_REVIEW" || record.outcome === "EXCLUDE") {
          await tx.ptaStudentProgressionRecord.update({ where: { id: record.id }, data: { status: "SKIPPED" } });
          skipped += 1;
          continue;
        }
        if (record.outcome === "TRANSFER" || record.outcome === "WITHDRAW") {
          await tx.ptaStudentProgressionRecord.update({ where: { id: record.id }, data: { status: "APPLIED" } });
          if (record.outcome === "TRANSFER") transferred += 1;
          else withdrawn += 1;
          continue;
        }
        if (record.outcome === "GRADUATE") {
          await tx.ptaStudentProgressionRecord.update({ where: { id: record.id }, data: { status: "APPLIED" } });
          graduated += 1;
          continue;
        }
        // PROMOTE, RETAIN, MANUAL: all create a target-year enrollment when
        // a target grade+classroom are present. Idempotent against
        // PtaStudentEnrollment's own unique(studentId, schoolYear) — if a
        // row already exists for this student+target year (e.g. someone
        // enrolled them manually ahead of this batch), reuse it rather
        // than erroring.
        if (!record.targetGradeId || !record.targetClassroomId) {
          await tx.ptaStudentProgressionRecord.update({ where: { id: record.id }, data: { status: "SKIPPED" } });
          skipped += 1;
          continue;
        }
        const existingTargetEnrollment = await tx.ptaStudentEnrollment.findFirst({
          where: { organizationId: input.organizationId, studentId: record.studentId, schoolYearId: batch.toSchoolYearId },
        });
        const targetEnrollment =
          existingTargetEnrollment ??
          (await tx.ptaStudentEnrollment.create({
            data: {
              organizationId: input.organizationId,
              studentId: record.studentId,
              classroomId: record.targetClassroomId,
              schoolYear: batch.toSchoolYear.label,
              schoolYearId: batch.toSchoolYearId,
              status: "ACTIVE",
            },
          }));
        await tx.ptaStudentProgressionRecord.update({
          where: { id: record.id },
          data: { status: "APPLIED", targetEnrollmentId: targetEnrollment.id },
        });
        if (record.outcome === "PROMOTE") promoted += 1;
        else retained += 1;
      } catch (err) {
        await tx.ptaStudentProgressionRecord.update({
          where: { id: record.id },
          data: { status: "FAILED", exceptionReason: err instanceof Error ? err.message.slice(0, 500) : "Unknown error" },
        });
        failed += 1;
      }
    }

    await tx.ptaStudentProgressionBatch.update({
      where: { id: input.batchId },
      data: { status: "COMMITTED", committedAt: new Date(), committedByUserId: input.actorUserId, commitIdempotencyKey: input.idempotencyKey },
    });
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.student_progression.batch_committed",
    entityType: "pta_student_progression_batch",
    entityId: input.batchId,
    metadata: { promoted, graduated, retained, transferred, withdrawn, skipped, failed },
  });

  return {
    batch: await getProgressionBatchDetail(input.organizationId, input.batchId),
    promoted,
    graduated,
    retained,
    transferred,
    withdrawn,
    skipped,
    failed,
  };
}

function summarizeCommittedBatch(batch: Awaited<ReturnType<typeof getProgressionBatchDetail>>): CommitProgressionBatchResult {
  const counts = { promoted: 0, graduated: 0, retained: 0, transferred: 0, withdrawn: 0, skipped: 0, failed: 0 };
  for (const record of batch.records) {
    if (record.status === "SKIPPED") counts.skipped += 1;
    else if (record.status === "FAILED") counts.failed += 1;
    else if (record.status === "APPLIED") {
      if (record.outcome === "PROMOTE") counts.promoted += 1;
      else if (record.outcome === "GRADUATE") counts.graduated += 1;
      else if (record.outcome === "TRANSFER") counts.transferred += 1;
      else if (record.outcome === "WITHDRAW") counts.withdrawn += 1;
      else counts.retained += 1;
    }
  }
  return { batch, ...counts };
}

export interface CorrectProgressionRecordInput extends ActorInput {
  organizationId: string;
  batchId: string;
  recordId: string;
  outcome: PtaStudentProgressionOutcome;
  targetGradeId?: string | null;
  targetClassroomId?: string | null;
  exceptionReason?: string | null;
}

/** Step 5's "safe correction" path: after commit, adjust ONE student's
 * outcome without touching any other record or reopening the batch. If the
 * corrected outcome now warrants a target enrollment (or a different one),
 * this creates/updates it the same way commit does — but scoped to a
 * single record, transactionally. */
export async function correctProgressionRecord(input: CorrectProgressionRecordInput) {
  const batch = await prisma.ptaStudentProgressionBatch.findFirst({
    where: { id: input.batchId, organizationId: input.organizationId },
    include: { toSchoolYear: true },
  });
  if (!batch) throw new PtaError("PTA_PROGRESSION_BATCH_NOT_FOUND", "Progression batch not found.");
  if (batch.status !== "COMMITTED" && batch.status !== "CORRECTED") {
    throw new PtaError("PTA_PROGRESSION_BATCH_NOT_CORRECTABLE", "Only a committed batch's individual records can be corrected.");
  }

  const record = await prisma.ptaStudentProgressionRecord.findFirst({ where: { id: input.recordId, batchId: input.batchId, organizationId: input.organizationId } });
  if (!record) throw new PtaError("PTA_PROGRESSION_RECORD_NOT_FOUND", "Progression record not found.");

  const updated = await prisma.$transaction(async (tx) => {
    let targetEnrollmentId = record.targetEnrollmentId;
    const needsEnrollment = ["PROMOTE", "RETAIN", "MANUAL"].includes(input.outcome) && input.targetGradeId && input.targetClassroomId;

    if (needsEnrollment) {
      const existingTargetEnrollment = await tx.ptaStudentEnrollment.findFirst({
        where: { organizationId: input.organizationId, studentId: record.studentId, schoolYearId: batch.toSchoolYearId },
      });
      if (existingTargetEnrollment) {
        await tx.ptaStudentEnrollment.update({ where: { id: existingTargetEnrollment.id }, data: { classroomId: input.targetClassroomId! } });
        targetEnrollmentId = existingTargetEnrollment.id;
      } else {
        const created = await tx.ptaStudentEnrollment.create({
          data: {
            organizationId: input.organizationId,
            studentId: record.studentId,
            classroomId: input.targetClassroomId!,
            schoolYear: batch.toSchoolYear.label,
            schoolYearId: batch.toSchoolYearId,
            status: "ACTIVE",
          },
        });
        targetEnrollmentId = created.id;
      }
    } else if (record.targetEnrollmentId) {
      // Corrected AWAY from an enrolling outcome — deactivate rather than
      // delete, preserving the row as history (matches PtaEnrollmentStatus's
      // own ACTIVE/INACTIVE convention; never a hard delete).
      await tx.ptaStudentEnrollment.update({ where: { id: record.targetEnrollmentId }, data: { status: "INACTIVE" } });
    }

    const updatedRecord = await tx.ptaStudentProgressionRecord.update({
      where: { id: record.id },
      data: {
        outcome: input.outcome,
        targetGradeId: input.targetGradeId ?? null,
        targetClassroomId: input.targetClassroomId ?? null,
        targetEnrollmentId: needsEnrollment ? targetEnrollmentId : null,
        exceptionReason: input.exceptionReason?.trim() || null,
        status: "APPLIED",
      },
    });

    await tx.ptaStudentProgressionBatch.update({
      where: { id: input.batchId },
      data: { status: "CORRECTED", correctedAt: new Date(), correctedByUserId: input.actorUserId },
    });

    return updatedRecord;
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.student_progression.record_corrected",
    entityType: "pta_student_progression_record",
    entityId: record.id,
    metadata: { studentId: record.studentId, before: record.outcome, after: input.outcome },
  });

  return updated;
}

/** Step 5's rollback path. Checked scope: PtaVolunteerLedgerEntry carries no
 * direct school-year reference (only an indirect, unreliable path through
 * requirementPeriodId), so "dependent target-year activity" is checked as
 * any volunteer-ledger entry recorded for an affected household SINCE this
 * batch was committed — a household with fresh ledger activity after its
 * students were progressed has real, dependent history a silent rollback
 * would orphan. This is a deliberately narrow, named check (volunteer
 * ledger activity since commit), not a claim of exhaustive coverage of
 * every possible dependent record type (attendance, dues, communications
 * are not checked here) — documented as a known limitation in the Phase C
 * test plan / final report, not silently assumed complete. */
export async function rollbackProgressionBatch(input: ActorInput & { organizationId: string; batchId: string }) {
  const batch = await prisma.ptaStudentProgressionBatch.findFirst({
    where: { id: input.batchId, organizationId: input.organizationId },
    include: { records: { include: { student: { select: { householdId: true } } } } },
  });
  if (!batch) throw new PtaError("PTA_PROGRESSION_BATCH_NOT_FOUND", "Progression batch not found.");
  if (batch.status !== "COMMITTED" && batch.status !== "CORRECTED") {
    throw new PtaError("PTA_PROGRESSION_BATCH_NOT_CORRECTABLE", "Only a committed batch can be rolled back.");
  }
  if (!batch.committedAt) {
    throw new PtaError("PTA_PROGRESSION_BATCH_NOT_CORRECTABLE", "This batch has no commit timestamp to check dependent activity against.");
  }

  const householdIds = [...new Set(batch.records.map((r) => r.student.householdId))];
  const dependentLedgerEntries = await prisma.ptaVolunteerLedgerEntry.findFirst({
    where: { organizationId: input.organizationId, householdId: { in: householdIds }, createdAt: { gt: batch.committedAt } },
    select: { id: true },
  });
  if (dependentLedgerEntries) {
    throw new PtaError(
      "PTA_PROGRESSION_ROLLBACK_BLOCKED_DEPENDENT_ACTIVITY",
      "This batch's target-year households already have volunteer-hour activity recorded for the target year. Correct individual records instead of rolling back the whole batch."
    );
  }

  await prisma.$transaction(async (tx) => {
    for (const record of batch.records) {
      if (record.targetEnrollmentId) {
        await tx.ptaStudentEnrollment.update({ where: { id: record.targetEnrollmentId }, data: { status: "INACTIVE" } });
      }
      await tx.ptaStudentProgressionRecord.update({ where: { id: record.id }, data: { status: "PLANNED", targetEnrollmentId: null } });
    }
    await tx.ptaStudentProgressionBatch.update({
      where: { id: input.batchId },
      data: { status: "ROLLED_BACK", rolledBackAt: new Date(), rolledBackByUserId: input.actorUserId },
    });
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.student_progression.batch_rolled_back",
    entityType: "pta_student_progression_batch",
    entityId: input.batchId,
    metadata: { recordCount: batch.records.length },
  });

  return getProgressionBatchDetail(input.organizationId, input.batchId);
}
