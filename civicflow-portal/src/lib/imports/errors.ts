/**
 * Resumable Import Program (PR A) — stable, machine-readable error codes.
 * Every code maps to a fixed HTTP status so routes never have to guess
 * (mirrors src/lib/hoa/errors.ts's HoaError pattern: one class, a code enum,
 * a status lookup table — not a subclass per error).
 */
export const IMPORT_ERROR_CODES = [
  /** A file with this sha256 hash was already uploaded for this
   * organization + importKind. The caller can still explicitly request a
   * new analysis (see ExistingBatchMatch on the create-batch response) —
   * this is a warning offered to the administrator, not a hard block. */
  "IMPORT_FILE_ALREADY_EXISTS",
  /** Resume requested on a batch that isn't PAUSED_PLAN_LIMIT (or another
   * resumable status) — e.g. already COMPLETED or CANCELED. */
  "IMPORT_BATCH_NOT_RESUMABLE",
  /** Import/resume requested but the organization has zero remaining
   * capacity for this import kind — never bypassed, always rechecked fresh
   * at resume time. */
  "IMPORT_PLAN_LIMIT_REACHED",
  /** A row is EXACT_DUPLICATE/POSSIBLE_DUPLICATE/UPDATE_AVAILABLE and still
   * has no decision — blocks that row from IMPORTING, not the whole batch. */
  "IMPORT_DUPLICATE_REVIEW_REQUIRED",
  /** A decision was submitted for a row already in a terminal status
   * (IMPORTED/SKIPPED/FAILED/BLOCKED_PLAN_LIMIT). */
  "IMPORT_ROW_ALREADY_PROCESSED",
  /** A decision was submitted after the batch moved past
   * READY_FOR_REVIEW (e.g. import already started) — the decision UI's
   * client-side state is stale relative to the server. */
  "IMPORT_STALE_DECISION",
  /** A batchId/rowId was resolved to a row that does not belong to the
   * caller's active organization. */
  "IMPORT_CROSS_TENANT_ACCESS",
  /** The submitted column mapping is missing a required canonical field, or
   * references a header not present in the parsed file. */
  "IMPORT_INVALID_MAPPING",
  /** The retained source file has already been deleted (past
   * retentionExpiresAt) — analysis/re-analysis can no longer read it. */
  "IMPORT_SOURCE_FILE_EXPIRED",
  /** Generic validation failure not covered by a more specific code above
   * (e.g. empty file, unsupported file type). */
  "IMPORT_VALIDATION_ERROR",
  /** Batch or row not found at all (as opposed to found-but-cross-tenant). */
  "IMPORT_NOT_FOUND",
] as const;

export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

const STATUS_FOR_CODE: Record<ImportErrorCode, number> = {
  IMPORT_FILE_ALREADY_EXISTS: 409,
  IMPORT_BATCH_NOT_RESUMABLE: 409,
  IMPORT_PLAN_LIMIT_REACHED: 403,
  IMPORT_DUPLICATE_REVIEW_REQUIRED: 409,
  IMPORT_ROW_ALREADY_PROCESSED: 409,
  IMPORT_STALE_DECISION: 409,
  IMPORT_CROSS_TENANT_ACCESS: 404,
  IMPORT_INVALID_MAPPING: 400,
  IMPORT_SOURCE_FILE_EXPIRED: 410,
  IMPORT_VALIDATION_ERROR: 400,
  IMPORT_NOT_FOUND: 404,
};

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  readonly status: number;

  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
  }
}
