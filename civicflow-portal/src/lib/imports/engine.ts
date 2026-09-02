import { Prisma, type ImportKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { transitionImportBatch } from "@/lib/imports/batch-state-machine";
import { getImportSourceFile } from "@/lib/imports/storage";
import { parseSpreadsheetBuffer, SpreadsheetValidationError } from "@/lib/imports/spreadsheet-parser";
import {
  computeRowFingerprint,
  normalizeMemberRow,
  type NormalizedMemberRow,
  computePtaHouseholdFingerprint,
  normalizePtaHouseholdRow,
  type NormalizedPtaHouseholdRow,
  computeHoaPropertyFingerprint,
  normalizeHoaPropertyRow,
  type NormalizedHoaPropertyRow,
} from "@/lib/imports/row-normalization";
import { buildPlanLimitSnapshot, checkImportCapacity, importKindConsumesCapacity } from "@/lib/imports/capacity";
import { matchCommunityMemberRow, matchPtaHouseholdRow, matchHoaPropertyRow } from "@/lib/imports/duplicate-matching";
import { createPtaHousehold, addPtaHouseholdAdult, addPtaStudent } from "@/lib/labs/pta/households";
import { createProperty, assignPropertyResident } from "@/lib/hoa/properties";
import { checkMemberLimit } from "@/lib/plan-gate";
import { ImportError } from "@/lib/imports/errors";

/**
 * Resumable Import Program (PR A) — the worker/engine core. Reuses the
 * platform's existing cron/worker convention (see
 * src/lib/labs/meeting-intelligence/worker.ts) — no new queue
 * infrastructure. Community members was the only vertical wired in PR A.
 *
 * PR C adds PTA households and HOA properties, dispatched by ImportKind in
 * both analyzeBatch() and executeBatch(). PTA/HOA rows are created/updated
 * exclusively through the same service-layer functions the officer UI and
 * the old importPtaHouseholds()/importHoaProperties() (vertical-import.ts)
 * already use — never raw Prisma writes — so validation, audit logging, and
 * tenant scoping stay identical regardless of which path created a record.
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

/** Security Patch A -- routes through the hardened shared parser
 * (spreadsheet-parser.ts) rather than the vulnerable `xlsx` package. A
 * malformed/rejected file surfaces as a normal ImportError so the batch
 * fails cleanly (FAILED status) instead of throwing an unhandled
 * exception mid-analysis. */
async function parseSpreadsheet(buffer: Buffer, fileName: string): Promise<Record<string, string>[]> {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  try {
    const { rows } = await parseSpreadsheetBuffer(buffer, extension);
    return rows;
  } catch (error) {
    if (error instanceof SpreadsheetValidationError) {
      throw new ImportError("IMPORT_VALIDATION_ERROR", error.message);
    }
    throw error;
  }
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
type AnalyzedRowStatus = "NEW" | "EXACT_DUPLICATE" | "POSSIBLE_DUPLICATE" | "UPDATE_AVAILABLE" | "INVALID";
type AnalyzedNormalizedData = NormalizedMemberRow | NormalizedPtaHouseholdRow | NormalizedHoaPropertyRow;

interface AnalyzedRow {
  normalized: AnalyzedNormalizedData;
  status: AnalyzedRowStatus;
  matchedRecordId: string | null;
  matchConfidence: number | null;
  errorMessage: string | null;
}

async function analyzeCommunityMemberRow(raw: Record<string, string>, mapping: Record<string, string>, organizationId: string): Promise<AnalyzedRow> {
  const normalized = normalizeMemberRow(raw, mapping);
  if (!normalized.firstName && !normalized.lastName) {
    return { normalized, status: "INVALID", matchedRecordId: null, matchConfidence: null, errorMessage: "First name and last name are both blank" };
  }
  if (normalized.emailError) {
    return { normalized, status: "INVALID", matchedRecordId: null, matchConfidence: null, errorMessage: normalized.emailError };
  }
  const match = await matchCommunityMemberRow(organizationId, normalized);
  return { normalized, status: match.status, matchedRecordId: match.matchedRecordId, matchConfidence: match.matchConfidence, errorMessage: null };
}

/** Same required-field checks as importPtaHouseholds() (vertical-import.ts). */
async function analyzePtaHouseholdRow(raw: Record<string, string>, mapping: Record<string, string>, organizationId: string): Promise<AnalyzedRow> {
  const normalized = normalizePtaHouseholdRow(raw, mapping);
  if (!normalized.householdName) {
    return { normalized, status: "INVALID", matchedRecordId: null, matchConfidence: null, errorMessage: "Household name is required" };
  }
  if (!normalized.schoolYear) {
    return { normalized, status: "INVALID", matchedRecordId: null, matchConfidence: null, errorMessage: "School year is required" };
  }
  if (!normalized.contactName) {
    return { normalized, status: "INVALID", matchedRecordId: null, matchConfidence: null, errorMessage: "Primary contact name is required" };
  }
  if (normalized.contactEmailError) {
    return { normalized, status: "INVALID", matchedRecordId: null, matchConfidence: null, errorMessage: normalized.contactEmailError };
  }
  const match = await matchPtaHouseholdRow(organizationId, normalized);
  return { normalized, status: match.status, matchedRecordId: match.matchedRecordId, matchConfidence: match.matchConfidence, errorMessage: null };
}

/** Same required-field check as importHoaProperties() (vertical-import.ts). */
async function analyzeHoaPropertyRow(raw: Record<string, string>, mapping: Record<string, string>, organizationId: string): Promise<AnalyzedRow> {
  const normalized = normalizeHoaPropertyRow(raw, mapping);
  if (!normalized.addressLine1) {
    return { normalized, status: "INVALID", matchedRecordId: null, matchConfidence: null, errorMessage: "Street address is required" };
  }
  if (normalized.ownerEmailError) {
    return { normalized, status: "INVALID", matchedRecordId: null, matchConfidence: null, errorMessage: normalized.ownerEmailError };
  }
  const match = await matchHoaPropertyRow(organizationId, normalized);
  return { normalized, status: match.status, matchedRecordId: match.matchedRecordId, matchConfidence: match.matchConfidence, errorMessage: null };
}

async function analyzeRow(importKind: ImportKind, raw: Record<string, string>, mapping: Record<string, string>, organizationId: string): Promise<AnalyzedRow> {
  if (importKind === "PTA_HOUSEHOLDS") return analyzePtaHouseholdRow(raw, mapping, organizationId);
  if (importKind === "HOA_PROPERTIES") return analyzeHoaPropertyRow(raw, mapping, organizationId);
  return analyzeCommunityMemberRow(raw, mapping, organizationId);
}

function fingerprintFor(importKind: ImportKind, normalized: AnalyzedNormalizedData): string {
  if (importKind === "PTA_HOUSEHOLDS") return computePtaHouseholdFingerprint(normalized as NormalizedPtaHouseholdRow);
  if (importKind === "HOA_PROPERTIES") return computeHoaPropertyFingerprint(normalized as NormalizedHoaPropertyRow);
  return computeRowFingerprint(normalized as NormalizedMemberRow);
}

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
  let rows: Record<string, string>[];
  try {
    rows = await parseSpreadsheet(buffer, batch.fileName);
  } catch (error) {
    if (error instanceof ImportError) {
      // A rejected/malformed file is an expected outcome now that the
      // parser enforces real structural limits (see spreadsheet-parser.ts)
      // -- surfaced as a clean FAILED batch (with its own audit event, via
      // transitionImportBatch) rather than left stuck in ANALYZING.
      await transitionImportBatch({ batchId, organizationId, to: "FAILED" });
      return;
    }
    throw error;
  }
  const mapping = batch.columnMapping as Record<string, string>;

  let newCount = 0;
  let updateCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // header is row 1 — matches importMembers()'s `i + 2` convention
    const raw = rows[i];
    const analyzed = await analyzeRow(batch.importKind, raw, mapping, organizationId);
    const fingerprint = fingerprintFor(batch.importKind, analyzed.normalized);

    if (analyzed.status === "INVALID") invalidCount += 1;
    else if (analyzed.status === "NEW") newCount += 1;
    else if (analyzed.status === "UPDATE_AVAILABLE") updateCount += 1;
    else duplicateCount += 1; // EXACT_DUPLICATE or POSSIBLE_DUPLICATE

    try {
      await prisma.importRow.create({
        data: {
          batchId,
          organizationId,
          rowNumber,
          rawData: raw,
          normalizedData: analyzed.normalized as unknown as Prisma.InputJsonValue,
          fingerprint,
          status: analyzed.status,
          matchedRecordId: analyzed.matchedRecordId,
          matchConfidence: analyzed.matchConfidence,
          errorMessage: analyzed.errorMessage,
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
    extraData: { totalRows: rows.length, newCount, updateCount, duplicateCount, invalidCount, claimedAt: null },
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

/**
 * Only includes a field in the update payload when the incoming value is
 * non-blank — a blank cell in the uploaded file means "no opinion," never
 * "clear this field." Previously this built a fixed object unconditionally,
 * so an update row with (say) a blank phone column would overwrite an
 * existing member's real phone number with null. This is also what makes
 * the EXACT_DUPLICATE/UPDATE_AVAILABLE distinction in duplicate-matching.ts
 * correct: a field only ever counts as "differing" (and only ever gets
 * written here) when the incoming value is both present and actually
 * different from the current one. Deliberately does not touch
 * membershipStatus, statusChanged (at/by/reason), isDelinquent,
 * delinquentSince, lastDuesEvaluationAt, membershipCategoryId, notes, or
 * userId — none of those
 * are mapped import fields, and none of this program's rows can ever
 * populate them, so those stay under the existing member-lifecycle
 * workflows exclusively.
 */
function memberUpdateData(normalized: NormalizedMemberRow): Prisma.OrgMemberUpdateInput {
  const data: Prisma.OrgMemberUpdateInput = {};
  if (normalized.firstName) data.firstName = normalized.firstName;
  if (normalized.lastName) data.lastName = normalized.lastName;
  if (normalized.phone) data.phone = normalized.phone;
  if (normalized.addressLine1) data.addressLine1 = normalized.addressLine1;
  if (normalized.city) data.city = normalized.city;
  if (normalized.state) data.state = normalized.state;
  if (normalized.zipCode) data.zipCode = normalized.zipCode;
  if (normalized.joinDate) data.joinDate = normalized.joinDate;
  return data;
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

interface ExecutedRow {
  importedRecordId: string;
  /** Non-null only for the HOA owner-member-limit graceful-degradation case
   * below — the row still succeeds (IMPORTED), this is surfaced as context,
   * never as a failure reason. */
  note: string | null;
}

async function executeCommunityMemberRow(
  row: { matchedRecordId: string | null; decision: string | null; normalizedData: unknown },
  organizationId: string
): Promise<ExecutedRow> {
  const normalized = row.normalizedData as unknown as NormalizedMemberRow;
  if (row.decision === "UPDATE_EXISTING" && row.matchedRecordId) {
    const updated = await prisma.orgMember.update({ where: { id: row.matchedRecordId }, data: memberUpdateData(normalized) });
    return { importedRecordId: updated.id, note: null };
  }
  const created = await prisma.orgMember.create({ data: memberCreateData(normalized, organizationId) });
  return { importedRecordId: created.id, note: null };
}

/**
 * Reuses createPtaHousehold/addPtaHouseholdAdult/addPtaStudent
 * (src/lib/labs/pta/households.ts) exactly as importPtaHouseholds()
 * (vertical-import.ts) does — same idempotent-per-student-name loop, same
 * "reuse the matched household id, don't recreate it" behavior for
 * UPDATE_EXISTING. A CREATE_ANYWAY on a row that matched an existing
 * household hits PtaHousehold's own DB unique constraint and surfaces as a
 * FAILED row via executeBatch()'s generic catch — structurally correct,
 * since the database itself won't allow a second household with the same
 * (organizationId, displayName, schoolYear).
 */
async function executePtaHouseholdRow(
  row: { matchedRecordId: string | null; decision: string | null; normalizedData: unknown },
  organizationId: string,
  actorUserId: string,
  actorEmail: string | null
): Promise<ExecutedRow> {
  const normalized = row.normalizedData as unknown as NormalizedPtaHouseholdRow;

  let householdId: string;
  if (row.decision === "UPDATE_EXISTING" && row.matchedRecordId) {
    householdId = row.matchedRecordId;
  } else {
    const household = await createPtaHousehold({
      organizationId,
      displayName: normalized.householdName,
      schoolYear: normalized.schoolYear,
      notes: normalized.notes,
      actorUserId,
      actorEmail,
    });
    householdId = household.id;
  }

  await addPtaHouseholdAdult({
    organizationId,
    householdId,
    name: normalized.contactName,
    email: normalized.contactEmail,
    phone: normalized.contactPhone,
    makePrimaryContact: true,
    actorUserId,
    actorEmail,
  });

  for (const displayName of normalized.studentNames) {
    // Idempotent per student name, same as importPtaHouseholds() — a
    // retried row with some students already added from a prior partial
    // failure doesn't duplicate them.
    const existingStudent = await prisma.ptaStudent.findFirst({ where: { householdId, displayName }, select: { id: true } });
    if (!existingStudent) {
      await addPtaStudent({ organizationId, householdId, displayName, actorUserId, actorEmail });
    }
  }

  return { importedRecordId: householdId, note: null };
}

/**
 * Reuses createProperty/assignPropertyResident (src/lib/hoa/properties.ts)
 * exactly as importHoaProperties() (vertical-import.ts) does, including its
 * exact owner-member-limit graceful-degradation behavior: if creating a new
 * owner OrgMember would exceed the plan's member limit, the property row
 * still succeeds (IMPORTED) — only the owner link is skipped, with a note
 * recorded so the reviewer knows to re-run after upgrading. This is a
 * deliberate, preserved-from-today behavior (see the PR C plan's capacity
 * decision), not a new BLOCKED_PLAN_LIMIT/batch-pause path — capacity is
 * rechecked fresh via checkMemberLimit() on every row that needs a new
 * owner, never trusted from a stale count.
 */
async function executeHoaPropertyRow(
  row: { matchedRecordId: string | null; decision: string | null; normalizedData: unknown },
  organizationId: string,
  actorUserId: string,
  actorEmail: string | null
): Promise<ExecutedRow> {
  const normalized = row.normalizedData as unknown as NormalizedHoaPropertyRow;

  let propertyId: string;
  if (row.decision === "UPDATE_EXISTING" && row.matchedRecordId) {
    propertyId = row.matchedRecordId;
  } else {
    const property = await createProperty({
      organizationId,
      addressLine1: normalized.addressLine1,
      addressLine2: normalized.addressLine2,
      city: normalized.city,
      state: normalized.state,
      zipCode: normalized.zipCode,
      unitLabel: normalized.unitLabel,
      buildingLabel: normalized.buildingLabel,
      propertyType: normalized.propertyType ?? undefined,
      notes: normalized.notes,
      actorUserId,
      actorEmail,
    });
    propertyId = property.id;
  }

  if (!normalized.ownerFirstName && !normalized.ownerLastName) {
    return { importedRecordId: propertyId, note: null };
  }

  const existingMember = normalized.ownerEmail
    ? await prisma.orgMember.findFirst({ where: { organizationId, email: normalized.ownerEmail }, select: { id: true } })
    : null;

  let memberId: string;
  if (existingMember) {
    memberId = existingMember.id;
  } else {
    const memberLimit = await checkMemberLimit(organizationId);
    if (!memberLimit.allowed || memberLimit.current >= memberLimit.limit) {
      return {
        importedRecordId: propertyId,
        note: `Property created, but owner not linked — member limit reached (${memberLimit.limit}). Upgrade your plan and re-run the import to link remaining owners.`,
      };
    }
    const created = await prisma.orgMember.create({
      data: {
        organizationId,
        firstName: normalized.ownerFirstName || "Unknown",
        lastName: normalized.ownerLastName || "Unknown",
        email: normalized.ownerEmail,
      },
      select: { id: true },
    });
    memberId = created.id;
  }

  const existingRelationship = await prisma.propertyResident.findFirst({
    where: { organizationId, propertyId, orgMemberId: memberId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!existingRelationship) {
    await assignPropertyResident({
      organizationId,
      propertyId,
      orgMemberId: memberId,
      relationshipType: normalized.relationshipType ?? "OWNER",
      isPrimaryContact: true,
      actorUserId,
      actorEmail,
    });
  }

  return { importedRecordId: propertyId, note: null };
}

/**
 * Walks eligible, decided rows in a bounded chunk (ROWS_PER_TICK), rechecks
 * capacity before every capacity-consuming write (Phase 16's explicit
 * requirement — not just once at the start), and pauses the moment capacity
 * runs out: remaining eligible rows are marked BLOCKED_PLAN_LIMIT in one
 * bulk update, a snapshot of the plan state is recorded, and the batch
 * transitions to PAUSED_PLAN_LIMIT rather than continuing or failing.
 */
export interface RequestActor {
  userId: string;
  email: string | null;
}

/**
 * `requestActor`, when provided, is the real caller who just triggered this
 * tick synchronously via POST .../start or .../resume — used to attribute
 * PTA/HOA service-layer audit events to the person who actually caused the
 * write, not the batch's original uploader. Omitted (undefined) when called
 * from the cron worker (processImportQueue()), which has no per-request
 * caller — that path falls back to the batch's uploadedByUserId, same as
 * before.
 */
export async function executeBatch(batchId: string, organizationId: string, requestActor?: RequestActor): Promise<void> {
  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, organizationId } });
  if (!batch) throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found.");

  // PTA/HOA rows go through the shared service-layer functions, which
  // require a real actorUserId (for audit-event attribution) — resolved
  // once per tick, not per row, and checked BEFORE claiming the batch so a
  // missing actor never leaves it stuck claimed. Community rows write via
  // raw Prisma calls and never need this.
  let actorUserId: string | null = null;
  let actorEmail: string | null = null;
  if (batch.importKind === "PTA_HOUSEHOLDS" || batch.importKind === "HOA_PROPERTIES") {
    if (requestActor) {
      actorUserId = requestActor.userId;
      actorEmail = requestActor.email;
    } else {
      if (!batch.uploadedByUserId) {
        throw new ImportError("IMPORT_MISSING_ACTOR", "This import batch has no recorded uploader and cannot create household/property records.");
      }
      actorUserId = batch.uploadedByUserId;
      const uploader = await prisma.user.findUnique({ where: { id: actorUserId }, select: { email: true } });
      actorEmail = uploader?.email ?? null;
    }
  }

  if (!(await claimBatchForProcessing(batchId, "IMPORTING"))) return;

  // SKIP decisions never touch capacity or write anything — resolved in bulk up front.
  const skipped = await prisma.importRow.updateMany({
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
  // Rows in this tick's eligible set that were already BLOCKED_PLAN_LIMIT
  // from a prior pause (eligibleRows' query doesn't exclude that status —
  // that's what makes them naturally pick back up on resume) and actually
  // got processed this tick, whether they succeeded or failed. Used below
  // to decrement blockedPlanLimitCount for rows no longer blocked —
  // previously this only ever incremented, so a batch that paused, resumed,
  // and fully completed still showed a stale nonzero "blocked" count.
  let resolvedFromBlocked = 0;

  for (const row of eligibleRows) {
    const createsNewRecord = row.decision === "IMPORT_NEW" || row.decision === "CREATE_ANYWAY";

    if (consumesCapacity && createsNewRecord) {
      const capacity = await checkImportCapacity(organizationId, batch.importKind);
      if (!capacity.allowed || capacity.remainingForThisBatch <= 0) {
        capacityExhausted = true;
        break;
      }
    }

    if (row.status === "BLOCKED_PLAN_LIMIT") resolvedFromBlocked += 1;

    try {
      const executed =
        batch.importKind === "PTA_HOUSEHOLDS"
          ? await executePtaHouseholdRow(row, organizationId, actorUserId!, actorEmail)
          : batch.importKind === "HOA_PROPERTIES"
            ? await executeHoaPropertyRow(row, organizationId, actorUserId!, actorEmail)
            : await executeCommunityMemberRow(row, organizationId);

      await prisma.importRow.update({
        where: { id: row.id },
        data: { status: "IMPORTED", importedRecordId: executed.importedRecordId, errorMessage: executed.note, processedAt: new Date() },
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
        skippedCount: { increment: skipped.count },
        // Net delta: newly (re-)blocked this tick minus previously-blocked
        // rows that got resolved before capacity ran out again.
        blockedPlanLimitCount: { increment: blocked.count - resolvedFromBlocked },
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
      data: {
        importedCount: { increment: imported },
        skippedCount: { increment: skipped.count },
        blockedPlanLimitCount: { increment: -resolvedFromBlocked },
        claimedAt: null,
      },
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
    extraData: {
      importedCount: { increment: imported },
      skippedCount: { increment: skipped.count },
      blockedPlanLimitCount: { increment: -resolvedFromBlocked },
      claimedAt: null,
    },
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
export async function resumeBatch(
  batchId: string,
  organizationId: string,
  actorUserId: string | null,
  requestActor?: RequestActor
): Promise<void> {
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
  await executeBatch(batchId, organizationId, requestActor);
}

export async function processImportQueue() {
  const analysis = await analyzePendingBatches();
  const execution = await executeImportingBatches();
  return { analysis, execution };
}
