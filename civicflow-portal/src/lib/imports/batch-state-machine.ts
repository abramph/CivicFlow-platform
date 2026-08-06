import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import type { ImportBatchStatus, Prisma } from "@prisma/client";
import { ImportError } from "@/lib/imports/errors";

/**
 * Resumable Import Program (PR A) — the authoritative batch lifecycle state
 * machine. Mirrors src/lib/labs/meeting-intelligence/state-machine.ts's
 * transitionJob() shape exactly: no route handler, worker, or UI action may
 * write ImportBatch.status directly via prisma — every status change goes
 * through transitionImportBatch() below, which validates the transition,
 * writes the relevant timestamp, and writes an audit event in the same call.
 */

const FORWARD_TRANSITIONS: Record<ImportBatchStatus, ImportBatchStatus[]> = {
  UPLOADED: ["ANALYZING", "FAILED", "CANCELED"],
  ANALYZING: ["READY_FOR_REVIEW", "FAILED", "CANCELED"],
  READY_FOR_REVIEW: ["IMPORTING", "CANCELED"],
  IMPORTING: ["PARTIALLY_COMPLETED", "PAUSED_PLAN_LIMIT", "COMPLETED", "FAILED", "CANCELED"],
  PARTIALLY_COMPLETED: ["IMPORTING", "COMPLETED", "CANCELED"],
  PAUSED_PLAN_LIMIT: ["IMPORTING", "CANCELED"],
  COMPLETED: [],
  FAILED: ["ANALYZING", "CANCELED"],
  CANCELED: [],
};

export function canTransitionImportBatch(from: ImportBatchStatus, to: ImportBatchStatus): boolean {
  return FORWARD_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalImportBatchStatus(status: ImportBatchStatus): boolean {
  return status === "COMPLETED" || status === "CANCELED";
}

/** Which timestamp column reaching a given status writes — mirrors the schema's per-status timestamp fields exactly. */
const TIMESTAMP_FIELD_FOR_STATUS: Partial<Record<ImportBatchStatus, string>> = {
  ANALYZING: "analyzedAt",
  IMPORTING: "importStartedAt",
  PAUSED_PLAN_LIMIT: "pausedAt",
  COMPLETED: "completedAt",
  PARTIALLY_COMPLETED: "completedAt",
};

export interface TransitionImportBatchInput {
  batchId: string;
  /** Every lookup is scoped by organizationId — never trust a bare batchId from a route param without this. */
  organizationId: string;
  to: ImportBatchStatus;
  actorUserId?: string | null;
  actorEmail?: string | null;
  /** Additional columns to set atomically with the status change (e.g. planLimitSnapshot, totalRows) — merged into the same update, never a second write. */
  extraData?: Prisma.ImportBatchUpdateInput;
}

/**
 * The sole write path for ImportBatch.status. Idempotent for a same-status
 * "transition" (returns the batch unchanged rather than throwing or
 * re-writing timestamps/audit — safe for a worker retry that re-observes a
 * status it already reached). Throws ImportError("IMPORT_NOT_FOUND") if the
 * batch doesn't belong to the given organizationId (tenant isolation), or a
 * generic invalid-transition Error otherwise.
 */
export async function transitionImportBatch(input: TransitionImportBatchInput) {
  const batch = await prisma.importBatch.findFirst({
    where: { id: input.batchId, organizationId: input.organizationId },
  });
  if (!batch) throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found.");

  if (batch.status === input.to) return batch;

  if (!canTransitionImportBatch(batch.status, input.to)) {
    throw new ImportError(
      "IMPORT_BATCH_NOT_RESUMABLE",
      `Cannot move import batch from ${batch.status} to ${input.to}.`
    );
  }

  const timestampField = TIMESTAMP_FIELD_FOR_STATUS[input.to];
  const data: Prisma.ImportBatchUpdateInput = {
    ...(input.extraData ?? {}),
    status: input.to,
    ...(timestampField ? { [timestampField]: new Date() } : {}),
  };

  const updated = await prisma.importBatch.update({ where: { id: batch.id }, data });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    actorEmail: input.actorEmail ?? null,
    action: `import_batch.${input.to.toLowerCase()}`,
    entityType: "import_batch",
    entityId: batch.id,
    metadata: { previousStatus: batch.status, newStatus: input.to },
  });

  return updated;
}
