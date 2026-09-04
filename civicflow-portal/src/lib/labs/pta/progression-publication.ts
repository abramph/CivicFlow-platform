import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { PtaError } from "./errors";
import { assertProgressionEnabled } from "./student-progression";

/**
 * Publish Progression Results — the explicit, audited disclosure step.
 *
 * The distinction this module exists to enforce:
 *   PREVIEWED  proposed movement, no enrollments written, never family-visible
 *   COMMITTED  target enrollments exist and are ACTIVE, still PRIVATE
 *   PUBLISHED  those committed results are disclosed to affected families
 *   WITHDRAWN  previously published, now hidden from future reads
 *   ROLLED_BACK target enrollments INACTIVE, nothing to show
 *
 * Before this module, a committed ACTIVE target enrollment became visible
 * to families immediately. That conflated "the office has finished the
 * data work" with "the school is ready to tell families", which are
 * different decisions made at different times by different people.
 *
 * Publication state lives on the batch because
 * `@@unique([organizationId, fromSchoolYearId, toSchoolYearId])` already
 * makes one batch the unique representation of a single source-to-target
 * transition — so two batches can never disagree about whether the same
 * transition is disclosed.
 *
 * Notifications are deliberately NOT sent from here. Publication changes
 * what the mobile app will show on its next read; announcing it is a
 * separate decision that has not been authorized.
 */

/** Outcomes that never represent a real, resolvable placement. */
const NON_PLACEMENT_OUTCOMES = ["GRADUATE", "TRANSFER", "WITHDRAW", "EXCLUDE"] as const;

export interface ProgressionPublicationStatus {
  batchId: string;
  status: string;
  publicationStatus: "UNPUBLISHED" | "PUBLISHED" | "WITHDRAWN";
  publicationVersion: number;
  publishedAt: Date | null;
  publishedByUserId: string | null;
  unpublishedAt: Date | null;
  unpublishedByUserId: string | null;
  fromSchoolYear: string;
  toSchoolYear: string;
  /** Records that would become family-visible. */
  eligibleCount: number;
  /** Records deliberately not disclosed (graduated/transferred/withdrawn/
   * excluded, or skipped) — reported as a count only. */
  excludedCount: number;
  /** Records that BLOCK publication until an administrator resolves them. */
  blockingCount: number;
  canPublish: boolean;
  blockingReasons: string[];
}

interface ActorInput {
  actorUserId: string;
  actorEmail?: string | null;
}

type BatchWithRecords = {
  id: string;
  status: string;
  publicationStatus: string;
  publicationVersion: number;
  publishedAt: Date | null;
  publishedByUserId: string | null;
  unpublishedAt: Date | null;
  unpublishedByUserId: string | null;
  publishIdempotencyKey: string | null;
  fromSchoolYearId: string;
  toSchoolYearId: string;
  fromSchoolYear: { label: string };
  toSchoolYear: { label: string };
  records: { id: string; outcome: string; status: string; targetEnrollmentId: string | null }[];
};

async function loadBatch(organizationId: string, batchId: string): Promise<BatchWithRecords> {
  const batch = await prisma.ptaStudentProgressionBatch.findFirst({
    // Organization-scoped by construction: a batch id belonging to another
    // tenant simply resolves to null, never to another org's data.
    where: { id: batchId, organizationId },
    include: {
      fromSchoolYear: { select: { label: true } },
      toSchoolYear: { select: { label: true } },
      records: { select: { id: true, outcome: true, status: true, targetEnrollmentId: true } },
    },
  });
  if (!batch) throw new PtaError("PTA_PROGRESSION_BATCH_NOT_FOUND", "Progression batch not found.");
  return batch as unknown as BatchWithRecords;
}

/**
 * Classifies a batch's records into eligible / excluded / blocking and
 * explains anything that blocks publication.
 *
 * Blocking policy: **block, do not partially publish.** A family shown
 * "Confirmed" for a student the office has not actually resolved is worse
 * than a family shown nothing yet, and a partial publish gives no signal
 * that anything is missing. Administrators resolve exceptions in the
 * portal (the correction/exception workflow already exists) and publish
 * once the year is genuinely settled.
 */
function classifyRecords(batch: BatchWithRecords) {
  const blockingReasons: string[] = [];
  let eligibleCount = 0;
  let excludedCount = 0;
  let blockingCount = 0;

  let unresolvedReview = 0;
  let failed = 0;
  let appliedWithoutEnrollment = 0;

  for (const record of batch.records) {
    if (record.outcome === "NEEDS_REVIEW" && record.status !== "APPLIED") {
      unresolvedReview += 1;
      blockingCount += 1;
      continue;
    }
    if (record.status === "FAILED") {
      failed += 1;
      blockingCount += 1;
      continue;
    }
    if ((NON_PLACEMENT_OUTCOMES as readonly string[]).includes(record.outcome) || record.status === "SKIPPED") {
      // Nothing to disclose for these — and deliberately no family-facing
      // wording is invented for graduation/transfer/withdrawal.
      excludedCount += 1;
      continue;
    }
    if (record.status === "APPLIED") {
      if (!record.targetEnrollmentId) {
        // "Every published result has a valid committed target enrollment."
        appliedWithoutEnrollment += 1;
        blockingCount += 1;
        continue;
      }
      eligibleCount += 1;
      continue;
    }
    // PLANNED with a placement outcome means the commit never applied it.
    blockingCount += 1;
    unresolvedReview += 1;
  }

  if (unresolvedReview > 0) {
    blockingReasons.push(`${unresolvedReview} student record(s) still need review or were never applied.`);
  }
  if (failed > 0) {
    blockingReasons.push(`${failed} student record(s) failed during commit and must be corrected first.`);
  }
  if (appliedWithoutEnrollment > 0) {
    blockingReasons.push(`${appliedWithoutEnrollment} applied record(s) have no target enrollment.`);
  }

  return { eligibleCount, excludedCount, blockingCount, blockingReasons };
}

function assertPublishableState(batch: BatchWithRecords): void {
  if (batch.status === "ROLLED_BACK") {
    throw new PtaError("PTA_PROGRESSION_ROLLED_BACK", "This batch was rolled back and cannot be published.");
  }
  if (batch.status !== "COMMITTED" && batch.status !== "CORRECTED") {
    throw new PtaError(
      "PTA_PROGRESSION_NOT_COMMITTED",
      "Only a committed batch can be published. Commit the progression first, then publish it to families."
    );
  }
  if (batch.fromSchoolYearId === batch.toSchoolYearId) {
    throw new PtaError("PTA_PROGRESSION_INVALID_YEAR_ORDER", "Source and target school years must differ.");
  }
}

/** Read-only publication status + publishability assessment. */
export async function getProgressionPublicationStatus(
  organizationId: string,
  batchId: string
): Promise<ProgressionPublicationStatus> {
  await assertProgressionEnabled(organizationId);
  const batch = await loadBatch(organizationId, batchId);
  const { eligibleCount, excludedCount, blockingCount, blockingReasons } = classifyRecords(batch);

  const committed = batch.status === "COMMITTED" || batch.status === "CORRECTED";
  const reasons = [...blockingReasons];
  if (batch.status === "ROLLED_BACK") reasons.push("This batch was rolled back.");
  else if (!committed) reasons.push("This batch has not been committed yet.");

  return {
    batchId: batch.id,
    status: batch.status,
    publicationStatus: batch.publicationStatus as ProgressionPublicationStatus["publicationStatus"],
    publicationVersion: batch.publicationVersion,
    publishedAt: batch.publishedAt,
    publishedByUserId: batch.publishedByUserId,
    unpublishedAt: batch.unpublishedAt,
    unpublishedByUserId: batch.unpublishedByUserId,
    fromSchoolYear: batch.fromSchoolYear.label,
    toSchoolYear: batch.toSchoolYear.label,
    eligibleCount,
    excludedCount,
    blockingCount,
    canPublish: committed && blockingCount === 0 && eligibleCount > 0 && batch.publicationStatus !== "PUBLISHED",
    blockingReasons: reasons,
  };
}

export interface PublishResult {
  batchId: string;
  publicationStatus: "PUBLISHED";
  publicationVersion: number;
  publishedAt: Date;
  eligibleCount: number;
  excludedCount: number;
  /** True when this call matched an already-recorded publication with the
   * same idempotency key and therefore changed nothing. */
  idempotentReplay: boolean;
}

/**
 * Publishes a committed batch's eligible results to families.
 *
 * Transactional, idempotent, and guarded by an optimistic
 * `publicationVersion`, so two concurrent publish requests cannot both
 * apply and a retried HTTP request is a safe no-op rather than a second
 * disclosure event.
 */
export async function publishProgressionResults(
  input: ActorInput & {
    organizationId: string;
    batchId: string;
    /** The publicationVersion the caller last saw. */
    publicationVersion: number;
    idempotencyKey: string;
  }
): Promise<PublishResult> {
  await assertProgressionEnabled(input.organizationId);
  const batch = await loadBatch(input.organizationId, input.batchId);

  // Idempotent replay: same key, already published -> report success
  // without recording a second disclosure.
  if (batch.publicationStatus === "PUBLISHED" && batch.publishIdempotencyKey === input.idempotencyKey) {
    const counts = classifyRecords(batch);
    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      action: "pta.progression.publish.replayed",
      entityType: "PtaStudentProgressionBatch",
      entityId: batch.id,
      metadata: {
        outcome: "IDEMPOTENT_REPLAY",
        fromSchoolYear: batch.fromSchoolYear.label,
        toSchoolYear: batch.toSchoolYear.label,
        eligibleCount: counts.eligibleCount,
      },
    });
    return {
      batchId: batch.id,
      publicationStatus: "PUBLISHED",
      publicationVersion: batch.publicationVersion,
      publishedAt: batch.publishedAt!,
      eligibleCount: counts.eligibleCount,
      excludedCount: counts.excludedCount,
      idempotentReplay: true,
    };
  }

  assertPublishableState(batch);

  const { eligibleCount, excludedCount, blockingCount, blockingReasons } = classifyRecords(batch);
  if (blockingCount > 0) {
    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      action: "pta.progression.publish.blocked",
      entityType: "PtaStudentProgressionBatch",
      entityId: batch.id,
      metadata: {
        outcome: "BLOCKED",
        fromSchoolYear: batch.fromSchoolYear.label,
        toSchoolYear: batch.toSchoolYear.label,
        blockingCount,
        eligibleCount,
        excludedCount,
        // Reasons are counts and categories only — never student names.
        blockingReasons,
      },
    });
    throw new PtaError(
      "PTA_PROGRESSION_PUBLISH_BLOCKED",
      `Publication is blocked: ${blockingReasons.join(" ")} Resolve these records, then publish.`
    );
  }

  if (eligibleCount === 0) {
    throw new PtaError("PTA_PROGRESSION_PUBLISH_BLOCKED", "There are no eligible results to publish for this batch.");
  }

  const publishedAt = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    // Optimistic concurrency: the version must still be the one the caller
    // saw AND the batch must still be unpublished. updateMany returns a
    // count, so a losing concurrent writer sees 0 and fails cleanly instead
    // of double-publishing.
    const result = await tx.ptaStudentProgressionBatch.updateMany({
      where: {
        id: batch.id,
        organizationId: input.organizationId,
        publicationVersion: input.publicationVersion,
        publicationStatus: { in: ["UNPUBLISHED", "WITHDRAWN"] },
      },
      data: {
        publicationStatus: "PUBLISHED",
        publishedAt,
        publishedByUserId: input.actorUserId,
        publicationVersion: { increment: 1 },
        publishIdempotencyKey: input.idempotencyKey,
      },
    });
    if (result.count === 0) {
      throw new PtaError(
        "PTA_PROGRESSION_PUBLICATION_STALE",
        "This batch's publication state changed since you loaded it. Reload and try again."
      );
    }
    await createAuditEvent({
      tx,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      action: "pta.progression.published",
      entityType: "PtaStudentProgressionBatch",
      entityId: batch.id,
      metadata: {
        outcome: "PUBLISHED",
        fromSchoolYear: batch.fromSchoolYear.label,
        toSchoolYear: batch.toSchoolYear.label,
        eligibleCount,
        excludedCount,
        publicationVersion: input.publicationVersion + 1,
      },
    });
    return input.publicationVersion + 1;
  });

  return {
    batchId: batch.id,
    publicationStatus: "PUBLISHED",
    publicationVersion: updated,
    publishedAt,
    eligibleCount,
    excludedCount,
    idempotentReplay: false,
  };
}

export interface UnpublishResult {
  batchId: string;
  publicationStatus: "WITHDRAWN";
  publicationVersion: number;
  unpublishedAt: Date;
}

/**
 * Withdraws a previously published batch from family view.
 *
 * This hides future results from subsequent mobile reads. It does NOT
 * undo the disclosure that already happened — families may have already
 * seen the results — which is why the state becomes WITHDRAWN rather than
 * reverting to UNPUBLISHED, and why the portal warns before calling this.
 */
export async function unpublishProgressionResults(
  input: ActorInput & { organizationId: string; batchId: string; publicationVersion: number }
): Promise<UnpublishResult> {
  await assertProgressionEnabled(input.organizationId);
  const batch = await loadBatch(input.organizationId, input.batchId);

  if (batch.publicationStatus !== "PUBLISHED") {
    throw new PtaError("PTA_PROGRESSION_NOT_PUBLISHED", "This batch is not currently published to families.");
  }

  const unpublishedAt = new Date();
  const nextVersion = await prisma.$transaction(async (tx) => {
    const result = await tx.ptaStudentProgressionBatch.updateMany({
      where: {
        id: batch.id,
        organizationId: input.organizationId,
        publicationVersion: input.publicationVersion,
        publicationStatus: "PUBLISHED",
      },
      data: {
        publicationStatus: "WITHDRAWN",
        unpublishedAt,
        unpublishedByUserId: input.actorUserId,
        publicationVersion: { increment: 1 },
        // Cleared so a later publish is a genuinely new disclosure event
        // rather than an idempotent replay of the withdrawn one.
        publishIdempotencyKey: null,
      },
    });
    if (result.count === 0) {
      throw new PtaError(
        "PTA_PROGRESSION_PUBLICATION_STALE",
        "This batch's publication state changed since you loaded it. Reload and try again."
      );
    }
    await createAuditEvent({
      tx,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      action: "pta.progression.unpublished",
      entityType: "PtaStudentProgressionBatch",
      entityId: batch.id,
      metadata: {
        outcome: "WITHDRAWN",
        fromSchoolYear: batch.fromSchoolYear.label,
        toSchoolYear: batch.toSchoolYear.label,
        // Recorded explicitly: withdrawal does not undo prior disclosure.
        priorDisclosureIrreversible: true,
        previouslyPublishedAt: batch.publishedAt,
        publicationVersion: input.publicationVersion + 1,
      },
    });
    return input.publicationVersion + 1;
  });

  return { batchId: batch.id, publicationStatus: "WITHDRAWN", publicationVersion: nextVersion, unpublishedAt };
}

/** Publication audit trail for one batch, newest first. Reuses the shared
 * AuditEvent store rather than adding a parallel history table. */
export async function getProgressionPublicationHistory(organizationId: string, batchId: string) {
  await assertProgressionEnabled(organizationId);
  // Confirms the batch belongs to this organization before returning any
  // audit rows keyed by its id.
  await loadBatch(organizationId, batchId);
  return prisma.auditEvent.findMany({
    where: {
      organizationId,
      resource: "PtaStudentProgressionBatch",
      resourceId: batchId,
      action: { startsWith: "pta.progression." },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, action: true, actorEmail: true, createdAt: true, after: true },
  });
}

// The rollback guard (`assertNotPublishedForRollback`) deliberately lives in
// student-progression.ts, not here: this module already imports
// `assertProgressionEnabled` from there, and defining the guard here too
// would create an import cycle between the two.
