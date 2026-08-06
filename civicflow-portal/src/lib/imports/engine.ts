import * as XLSX from "xlsx";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { transitionImportBatch } from "@/lib/imports/batch-state-machine";
import { getImportSourceFile } from "@/lib/imports/storage";
import { computeRowFingerprint, normalizeMemberRow, type NormalizedMemberRow } from "@/lib/imports/row-normalization";
import { buildPlanLimitSnapshot, checkImportCapacity, importKindConsumesCapacity } from "@/lib/imports/capacity";
import { ImportError } from "@/lib/imports/errors";

/**
 * Resumable Import Program (PR A) — the worker/engine core. Reuses the
 * platform's existing cron/worker convention (see
 * src/lib/labs/meeting-intelligence/worker.ts) — no new queue
 * infrastructure. Community members is the only vertical wired in PR A;
 * PTA/HOA/Union follow in PR C once this foundation is proven.
 */

const ANALYZE_BATCH_LIMIT = 10;
const EXECUTE_BATCH_LIMIT = 5;
/** Rows written per executeBatch() tick — bounded so a single cron
 * invocation can't run indefinitely, mirroring Meeting Intelligence's
 * BATCH_LIMIT precedent. A batch with more eligible rows than this simply
 * stays IMPORTING and gets picked up again on the next tick. */
const ROWS_PER_TICK = 100;

// Same staleness-reclaim window as Meeting Intelligence's CLAIM_STALE_AFTER_MS
// — well above any realistic single-tick duration so a merely-slow-but-alive
// worker is never preempted, but a crashed one doesn't strand the batch.
export const CLAIM_STALE_AFTER_MS = 10 * 60_000;

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Atomically claims a batch for processing — a conditional UPDATE (WHERE
 * status = expectedStatus AND (claimedAt IS NULL OR claimedAt < staleThreshold))
 * that only one concurrent cron invocation can win. Returns false if another
 * invocation won the claim or the batch already moved on (not an error —
 * the caller should just skip it this tick).
 */
async function claimBatchForProcessing(batchId: string, expectedStatus: "UPLOADED" | "IMPORTING"): Promise<boolean> {
  const staleThreshold = new Date(Date.now() - CLAIM_STALE_AFTER_MS);
  const result = await prisma.importBatch.updateMany({
    where: {
      id: batchId,
      status: expectedStatus,
      OR: [{ claimedAt: null }, { claimedAt: { lt: staleThreshold } }],
    },
    data: { claimedAt: new Date() },
  });
  return result.count === 1;
}

function parseSpreadsheet(buffer: Buffer): Record<string, string>[] {
  const wb = XLSX.read(buffer, { type: "buffer", dateNF: "yyyy-mm-dd" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, string>>(ws, { raw: false, defval: "" });
}

/**
 * Parses the retained source file, normalizes + fingerprints + classifies
 * every row, and persists them as ImportRow records. Only NEW, INVALID, and
 * (for Community members' preserved exact-email-match rule) UPDATE_AVAILABLE
 * are ever produced in PR A — EXACT_DUPLICATE/POSSIBLE_DUPLICATE are PR B's
 * job. Idempotent: a retried analysis (e.g. after a crash mid-run) re-inserts
 * the same rows, and duplicate inserts hit the (batchId, rowNumber) unique
 * constraint (P2002), caught and skipped rather than erroring — same idiom
 * as src/lib/hoa/violations.ts's isUniqueConstraintViolation.
 */
export async function analyzeBatch(batchId: string, organizationId: string): Promise<void> {
  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, organizationId } });
  if (!batch) throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found.");
  if (!(await claimBatchForProcessing(batchId, "UPLOADED"))) return;

  await transitionImportBatch({ batchId, organizationId, to: "ANALYZING" });

  if (!batch.storageObjectKey) {
    await transitionImportBatch({ batchId, organizationId, to: "FAILED" });
    return;
  }

  const buffer = await getImportSourceFile(batch.storageObjectKey);
  const rows = parseSpreadsheet(buffer);
  const mapping = batch.columnMapping as Record<string, string>;

  let newCount = 0;
  let updateCount = 0;
  let invalidCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // header is row 1 — matches importMembers()'s `i + 2` convention
    const raw = rows[i];
    const normalized = normalizeMemberRow(raw, mapping);
    const fingerprint = computeRowFingerprint(normalized);

    let status: "NEW" | "UPDATE_AVAILABLE" | "INVALID";
    let matchedRecordId: string | null = null;
    let errorMessage: string | null = null;

    if (!normalized.firstName && !normalized.lastName) {
      status = "INVALID";
      errorMessage = "First name and last name are both blank";
      invalidCount += 1;
    } else if (normalized.emailError) {
      status = "INVALID";
      errorMessage = normalized.emailError;
      invalidCount += 1;
    } else {
      const existing = normalized.email
        ? await prisma.orgMember.findFirst({ where: { organizationId, email: normalized.email }, select: { id: true } })
        : null;
      if (existing) {
        status = "UPDATE_AVAILABLE";
        matchedRecordId = existing.id;
        updateCount += 1;
      } else {
        status = "NEW";
        newCount += 1;
      }
    }

    try {
      await prisma.importRow.create({
        data: {
          batchId,
          organizationId,
          rowNumber,
          rawData: raw,
          normalizedData: normalized as unknown as Prisma.InputJsonValue,
          fingerprint,
          status,
          matchedRecordId,
          errorMessage,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      // Already analyzed in a prior (interrupted) run — not an error, just
      // don't double-insert. Counts above still reflect this row correctly
      // since classification is deterministic per row.
    }
  }

  await transitionImportBatch({
    batchId,
    organizationId,
    to: "READY_FOR_REVIEW",
    extraData: { totalRows: rows.length, newCount, updateCount, invalidCount, claimedAt: null },
  });
}

/** Picks up UPLOADED batches ready to analyze. */
export async function analyzePendingBatches(limit = ANALYZE_BATCH_LIMIT): Promise<{ processed: number }> {
  const batches = await prisma.importBatch.findMany({
    where: { status: "UPLOADED" },
    take: limit,
    orderBy: { uploadedAt: "asc" },
  });
  for (const batch of batches) {
    await analyzeBatch(batch.id, batch.organizationId);
  }
  return { processed: batches.length };
}

/**
 * Applies the spec's safe default decisions to any row still undecided
 * (Phase 2's "safe default decisions" table). Called once, right before a
 * batch moves READY_FOR_REVIEW -> IMPORTING, so an administrator who
 * accepted every default without touching individual rows still gets the
 * conservative, never-auto-merge behavior.
 */
export async function applyDefaultDecisions(batchId: string): Promise<void> {
  await prisma.importRow.updateMany({
    where: { batchId, status: "NEW", decision: null },
    data: { decision: "IMPORT_NEW" },
  });
  await prisma.importRow.updateMany({
    where: { batchId, status: "EXACT_DUPLICATE", decision: null },
    data: { decision: "SKIP" },
  });
  await prisma.importRow.updateMany({
    where: { batchId, status: { in: ["POSSIBLE_DUPLICATE", "UPDATE_AVAILABLE"] }, decision: null },
    data: { decision: "REVIEW_REQUIRED" },
  });
}

function memberUpdateData(normalized: NormalizedMemberRow): Prisma.OrgMemberUpdateInput {
  return {
    firstName: normalized.firstName || "Unknown",
    lastName: normalized.lastName || "Unknown",
    phone: normalized.phone,
    addressLine1: normalized.addressLine1,
    city: normalized.city,
    state: normalized.state,
    zipCode: normalized.zipCode,
    joinDate: normalized.joinDate,
  };
}

function memberCreateData(normalized: NormalizedMemberRow, organizationId: string): Prisma.OrgMemberCreateInput {
  return {
    organization: { connect: { id: organizationId } },
    firstName: normalized.firstName || "Unknown",
    lastName: normalized.lastName || "Unknown",
    email: normalized.email,
    phone: normalized.phone,
    addressLine1: normalized.addressLine1,
    city: normalized.city,
    state: normalized.state,
    zipCode: normalized.zipCode,
    joinDate: normalized.joinDate,
  };
}

/**
 * Walks eligible, decided rows in a bounded chunk (ROWS_PER_TICK), rechecks
 * capacity before every capacity-consuming write (Phase 16's explicit
 * requirement — not just once at the start), and pauses the moment capacity
 * runs out: remaining eligible rows are marked BLOCKED_PLAN_LIMIT in one
 * bulk update, a snapshot of the plan state is recorded, and the batch
 * transitions to PAUSED_PLAN_LIMIT rather than continuing or failing.
 */
export async function executeBatch(batchId: string, organizationId: string): Promise<void> {
  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, organizationId } });
  if (!batch) throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found.");
  if (!(await claimBatchForProcessing(batchId, "IMPORTING"))) return;

  // SKIP decisions never touch capacity or write anything — resolved in bulk up front.
  await prisma.importRow.updateMany({
    where: { batchId, decision: "SKIP", status: { notIn: ["IMPORTED", "SKIPPED", "FAILED"] } },
    data: { status: "SKIPPED", processedAt: new Date() },
  });

  const eligibleRows = await prisma.importRow.findMany({
    where: {
      batchId,
      decision: { in: ["IMPORT_NEW", "UPDATE_EXISTING", "CREATE_ANYWAY"] },
      status: { notIn: ["IMPORTED", "SKIPPED", "FAILED"] },
    },
    take: ROWS_PER_TICK,
    orderBy: { rowNumber: "asc" },
  });

  const consumesCapacity = importKindConsumesCapacity(batch.importKind);
  let imported = 0;
  let capacityExhausted = false;

  for (const row of eligibleRows) {
    const createsNewRecord = row.decision === "IMPORT_NEW" || row.decision === "CREATE_ANYWAY";

    if (consumesCapacity && createsNewRecord) {
      const capacity = await checkImportCapacity(organizationId, batch.importKind);
      if (!capacity.allowed || capacity.remainingForThisBatch <= 0) {
        capacityExhausted = true;
        break;
      }
    }

    try {
      const normalized = row.normalizedData as unknown as NormalizedMemberRow;
      let importedRecordId: string;

      if (row.decision === "UPDATE_EXISTING" && row.matchedRecordId) {
        const updated = await prisma.orgMember.update({
          where: { id: row.matchedRecordId },
          data: memberUpdateData(normalized),
        });
        importedRecordId = updated.id;
      } else {
        const created = await prisma.orgMember.create({
          data: memberCreateData(normalized, organizationId),
        });
        importedRecordId = created.id;
      }

      await prisma.importRow.update({
        where: { id: row.id },
        data: { status: "IMPORTED", importedRecordId, processedAt: new Date() },
      });
      imported += 1;
    } catch (error) {
      await prisma.importRow.update({
        where: { id: row.id },
        data: { status: "FAILED", errorMessage: error instanceof Error ? error.message : String(error), processedAt: new Date() },
      });
    }
  }

  if (capacityExhausted) {
    const blocked = await prisma.importRow.updateMany({
      where: {
        batchId,
        decision: { in: ["IMPORT_NEW", "CREATE_ANYWAY"] },
        status: { notIn: ["IMPORTED", "SKIPPED", "FAILED"] },
      },
      data: { status: "BLOCKED_PLAN_LIMIT" },
    });
    const snapshot = await buildPlanLimitSnapshot(batchId, organizationId, batch.importKind);
    await transitionImportBatch({
      batchId,
      organizationId,
      to: "PAUSED_PLAN_LIMIT",
      extraData: {
        importedCount: { increment: imported },
        skippedCount: { increment: 0 },
        blockedPlanLimitCount: { increment: blocked.count },
        planLimitSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        claimedAt: null,
      },
    });
    return;
  }

  const remainingEligible = await prisma.importRow.count({
    where: { batchId, decision: { in: ["IMPORT_NEW", "UPDATE_EXISTING", "CREATE_ANYWAY"] }, status: { notIn: ["IMPORTED", "SKIPPED", "FAILED"] } },
  });

  if (remainingEligible > 0) {
    // More work than this tick could handle — stay IMPORTING, release the
    // claim immediately so the next cron tick can pick it straight back up
    // rather than waiting out the staleness window.
    await prisma.importBatch.update({
      where: { id: batchId },
      data: { importedCount: { increment: imported }, claimedAt: null },
    });
    return;
  }

  const remainingNeedingReview = await prisma.importRow.count({
    where: { batchId, status: { in: ["EXACT_DUPLICATE", "POSSIBLE_DUPLICATE", "UPDATE_AVAILABLE"] }, decision: null },
  });

  await transitionImportBatch({
    batchId,
    organizationId,
    to: remainingNeedingReview > 0 ? "PARTIALLY_COMPLETED" : "COMPLETED",
    extraData: { importedCount: { increment: imported }, claimedAt: null },
  });
}

/** Picks up IMPORTING batches ready for their next tick. */
export async function executeImportingBatches(limit = EXECUTE_BATCH_LIMIT): Promise<{ processed: number }> {
  const batches = await prisma.importBatch.findMany({
    where: { status: "IMPORTING" },
    take: limit,
    orderBy: { importStartedAt: "asc" },
  });
  for (const batch of batches) {
    await executeBatch(batch.id, batch.organizationId);
  }
  return { processed: batches.length };
}

/**
 * Resumes a PAUSED_PLAN_LIMIT batch. Always rechecks capacity fresh (Phase
 * 9's explicit requirement — never trusts the old planLimitSnapshot),
 * transitions PAUSED_PLAN_LIMIT -> IMPORTING, resets any BLOCKED_PLAN_LIMIT
 * rows back to eligible (their decision was never cleared), and runs an
 * immediate first tick so the administrator sees progress right away rather
 * than waiting for the next cron invocation.
 */
export async function resumeBatch(batchId: string, organizationId: string, actorUserId: string | null): Promise<void> {
  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, organizationId } });
  if (!batch) throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found.");
  if (batch.status !== "PAUSED_PLAN_LIMIT") {
    throw new ImportError("IMPORT_BATCH_NOT_RESUMABLE", `Batch is ${batch.status}, not paused for a plan limit.`);
  }

  const capacity = await checkImportCapacity(organizationId, batch.importKind);
  if (capacity.allowed === false || capacity.remainingForThisBatch <= 0) {
    throw new ImportError(
      "IMPORT_PLAN_LIMIT_REACHED",
      "Your organization still has no remaining capacity. Upgrade your plan before resuming."
    );
  }

  await transitionImportBatch({ batchId, organizationId, to: "IMPORTING", actorUserId });
  await executeBatch(batchId, organizationId);
}

export async function processImportQueue() {
  const analysis = await analyzePendingBatches();
  const execution = await executeImportingBatches();
  return { analysis, execution };
}
