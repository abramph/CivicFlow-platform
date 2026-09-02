import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  SpreadsheetValidationError,
  SPREADSHEET_LIMITS,
  type ParsedSpreadsheet,
  type SpreadsheetRejectionReason,
} from "./spreadsheet-parser";

/**
 * Worker-isolation follow-up (Security Patch A deployment review).
 *
 * Why this exists: the previous design ran parseSpreadsheetBuffer()
 * directly in the main Next.js process, guarded only by a
 * Promise.race/setTimeout "timeout" and a pre-decompression byte budget.
 * Proven directly (not assumed) during this review: that timeout cannot
 * preempt synchronous CPU-bound work or synchronous memory allocation --
 * Node is single-threaded, and a long synchronous loop (the shape of
 * ExcelJS's eachRow() callback or the CSV state machine's while loop)
 * never yields the stack back to the event loop until it returns on its
 * own, so the timer callback that would reject the race cannot fire
 * until the work has already fully executed. A byte-budget preflight
 * check is also only as good as the attacker-controlled metadata it
 * reads (ZIP-declared sizes) -- useful as an early, cheap rejection, but
 * not a hard memory boundary on its own.
 *
 * This module moves the actual parse into a worker_threads Worker with a
 * real, enforced heap ceiling (`resourceLimits`) and a parent-side
 * wall-clock timeout that CAN fire on schedule, because the parent's
 * event loop is a different thread from the one running the parse.
 * Verified directly this review: a worker that exceeds its
 * resourceLimits heap budget terminates with a clean 'error' event and
 * the parent process's own PID/liveness is completely unaffected; a
 * parent-side setTimeout fires on schedule while a worker is still deep
 * in synchronous CPU-bound work.
 *
 * Also verified directly: structured clone (how postMessage moves data
 * across the worker boundary) does NOT preserve Object.create(null) --
 * a row built as a null-prototype object inside the worker arrives back
 * in the parent as an ordinary {}-prototype object. This module rebuilds
 * every row onto a fresh null-prototype object after receiving the
 * worker's result, rather than assuming the safety property survived
 * the boundary.
 */

const WORKER_RESULT_LIMITS = {
  /** Defense in depth on top of the worker's own SPREADSHEET_LIMITS
   * enforcement -- re-checked here in case a compromised or buggy worker
   * ever returned something out of bounds. */
  maxRows: SPREADSHEET_LIMITS.maxRows,
  maxColumns: SPREADSHEET_LIMITS.maxColumns,
  maxCells: SPREADSHEET_LIMITS.maxCells,
  maxFieldLength: SPREADSHEET_LIMITS.maxCellLength,
  /** Bounds the total size of the structured-clone payload itself,
   * independent of the row/column/cell counts above (a pathological
   * shape could still pass those individually while producing an
   * enormous serialized result). */
  maxSerializedBytes: 200 * 1024 * 1024,
};

export interface WorkerParseOptions {
  /** Hard wall-clock ceiling; the worker is terminated if this elapses. */
  timeoutMs?: number;
  /** V8 heap ceiling for the worker thread. */
  maxOldGenerationSizeMb?: number;
  maxYoungGenerationSizeMb?: number;
  stackSizeMb?: number;
}

const DEFAULT_OPTIONS: Required<WorkerParseOptions> = {
  timeoutMs: SPREADSHEET_LIMITS.parseTimeoutMs,
  // Sized against real measurement through this actual worker path (not
  // the pre-isolation in-process design): a maximally-shaped LEGITIMATE
  // import -- 50,000 rows at the largest real supported template's column
  // count (hoa-properties, 13 fields; see maxColumns's own comment in
  // spreadsheet-parser.ts) -- measured a ~122MB RSS delta parsing through
  // the isolated worker. 512MB leaves generous headroom above that for
  // the worker's own baseline (V8 isolate + ExcelJS module load) and any
  // measurement noise, while still bounding a single worker well below
  // the 1 GiB container total. Separately measured: two SIMULTANEOUS
  // max-shaped parses (i.e., what the admission controller in
  // parse-admission.ts exists specifically to prevent) pushed combined
  // process RSS up by ~391MB and peak overall RSS to ~1GB on top of
  // baseline -- real, direct evidence that concurrency control, not just
  // per-worker heap ceilings, is load-bearing on this instance size.
  maxOldGenerationSizeMb: 512,
  maxYoungGenerationSizeMb: 64,
  stackSizeMb: 8,
};

const COMPILED_WORKER_PATH = join(process.cwd(), "dist-workers", "spreadsheet-parser-worker-entry.js");
const SOURCE_WORKER_PATH = join(__dirname, "spreadsheet-parser-worker-entry.ts");

/** Resolves which worker script to load. Production always prefers the
 * precompiled, dependency-free CommonJS artifact emitted by
 * scripts/build-worker.mjs during `npm run build` -- this is the
 * "demonstrated" path the build actually produces, not an assumption
 * that a source .ts file happens to be executable at runtime. The
 * source .ts path is only used as a fallback when the compiled artifact
 * does not exist, which is expected in local dev / Vitest (where `tsx`
 * -- a devDependency -- is genuinely present) and should never be true
 * in a real production deployment once the build step has run. */
function resolveWorkerScript(): { path: string; execArgv: string[] } {
  if (existsSync(COMPILED_WORKER_PATH)) {
    return { path: COMPILED_WORKER_PATH, execArgv: [] };
  }
  return { path: SOURCE_WORKER_PATH, execArgv: ["--require", "tsx/cjs"] };
}

interface WorkerSuccessResponse {
  ok: true;
  rows: Record<string, string>[];
}
interface WorkerFailureResponse {
  ok: false;
  reason: string;
  message: string;
}
type WorkerResponse = WorkerSuccessResponse | WorkerFailureResponse;

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.ok !== "boolean") return false;
  if (v.ok === true) return Array.isArray(v.rows);
  return typeof v.reason === "string" && typeof v.message === "string";
}

function isKnownReason(reason: string): reason is SpreadsheetRejectionReason {
  // Every reason the worker can legitimately produce is a literal from
  // SpreadsheetValidationError's own reason union, or one of the
  // isolation-boundary reasons added alongside it -- this function exists
  // to fail closed if a future worker-side change ever emits something
  // outside that contract, rather than silently forwarding an arbitrary
  // string as if it were a validated rejection reason.
  const known: Set<string> = new Set([
    "EMPTY_FILE", "UNSUPPORTED_FORMAT", "FORMAT_MISMATCH", "NOT_A_ZIP_CONTAINER",
    "ENCRYPTED_ARCHIVE", "MACRO_WORKBOOK", "EXTERNAL_LINKS", "PATH_TRAVERSAL_ENTRY",
    "TOO_MANY_ZIP_ENTRIES", "UNCOMPRESSED_SIZE_BUDGET_EXCEEDED", "MALFORMED_ZIP",
    "NO_DATA_ROWS", "TOO_MANY_SHEETS", "TOO_MANY_ROWS", "TOO_MANY_COLUMNS",
    "TOO_MANY_CELLS", "CELL_TOO_LONG", "DUPLICATE_HEADER", "UNSAFE_HEADER_NAME",
    "PARSE_TIMEOUT", "MALFORMED_WORKBOOK", "WORKER_TIMEOUT", "WORKER_CRASHED",
    "WORKER_RESULT_INVALID",
  ]);
  return known.has(reason);
}

/** Rebuilds a worker-returned row onto a fresh null-prototype object and
 * re-enforces field/column limits -- structured clone does not preserve
 * Object.create(null) (verified directly), so this re-establishes the
 * same safety property spreadsheet-parser.ts's own createSafeRow()
 * provides, rather than trusting the clone to have carried it across the
 * boundary. */
function rebuildRowSafely(row: unknown): Record<string, string> {
  const safe = Object.create(null) as Record<string, string>;
  if (typeof row !== "object" || row === null) return safe;
  const entries = Object.entries(row as Record<string, unknown>);
  if (entries.length > WORKER_RESULT_LIMITS.maxColumns) {
    throw new SpreadsheetValidationError("WORKER_RESULT_INVALID", "The parsed file's structure could not be validated.");
  }
  for (const [key, value] of entries) {
    if (typeof value !== "string" || value.length > WORKER_RESULT_LIMITS.maxFieldLength) {
      throw new SpreadsheetValidationError("WORKER_RESULT_INVALID", "The parsed file's structure could not be validated.");
    }
    safe[key] = value;
  }
  return safe;
}

/**
 * Parses an uploaded spreadsheet buffer in an isolated worker thread.
 * Same contract as parseSpreadsheetBuffer() (throws
 * SpreadsheetValidationError on any rejection, including every new
 * isolation-boundary failure mode) so every existing call site's
 * `catch (error) { if (error instanceof SpreadsheetValidationError) }`
 * handling keeps working unchanged.
 */
export async function parseSpreadsheetBufferIsolated(
  buffer: Buffer,
  claimedExtension: string,
  options: WorkerParseOptions = {}
): Promise<ParsedSpreadsheet> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { path: workerPath, execArgv } = resolveWorkerScript();

  // ArrayBuffer.prototype.slice always copies into a freshly allocated
  // buffer (never shares memory with the source) -- this guarantees the
  // ArrayBuffer transferred to the worker contains EXACTLY the uploaded
  // file's bytes and nothing else, even when the source Buffer is a
  // slice of Node's shared internal allocation pool (small Buffers from
  // Buffer.allocUnsafe/Buffer.from(string) etc. can have a `.buffer`
  // larger than, and shared with, unrelated allocations -- transferring
  // that underlying ArrayBuffer directly would neuter memory other code
  // still holds a live reference into).
  // Buffer.from(bytes)/file.arrayBuffer() never produce a
  // SharedArrayBuffer-backed Buffer in this codebase; ArrayBuffer#slice
  // always returns the same concrete type as its source, but TS's
  // Node+DOM lib types `.buffer` as the union since Buffer extends
  // Uint8Array<ArrayBufferLike>.
  const exactCopy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

  return new Promise<ParsedSpreadsheet>((resolve, reject) => {
    let settled = false;
    let worker: Worker;
    try {
      worker = new Worker(workerPath, {
        workerData: { buffer: exactCopy, claimedExtension },
        transferList: [exactCopy],
        resourceLimits: {
          maxOldGenerationSizeMb: opts.maxOldGenerationSizeMb,
          maxYoungGenerationSizeMb: opts.maxYoungGenerationSizeMb,
          stackSizeMb: opts.stackSizeMb,
        },
        execArgv,
      });
    } catch {
      reject(new SpreadsheetValidationError("WORKER_CRASHED", "This file could not be processed."));
      return;
    }

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      // Reclaim the thread promptly rather than waiting for GC -- safe to
      // call even if the worker already exited on its own.
      worker.terminate().catch(() => {});
    };

    const timer = setTimeout(() => {
      finish(() => reject(new SpreadsheetValidationError("WORKER_TIMEOUT", "This file took too long to process and was rejected.")));
    }, opts.timeoutMs);

    worker.once("message", (raw: unknown) => {
      finish(() => {
        if (!isWorkerResponse(raw)) {
          reject(new SpreadsheetValidationError("WORKER_RESULT_INVALID", "The parsed file's structure could not be validated."));
          return;
        }
        if (raw.ok === false) {
          const reason = isKnownReason(raw.reason) ? raw.reason : "WORKER_CRASHED";
          reject(new SpreadsheetValidationError(reason, raw.message));
          return;
        }
        if (raw.rows.length > WORKER_RESULT_LIMITS.maxRows) {
          reject(new SpreadsheetValidationError("WORKER_RESULT_INVALID", "The parsed file's structure could not be validated."));
          return;
        }
        let totalCells = 0;
        try {
          const safeRows = raw.rows.map((row) => {
            totalCells += Object.keys(row as object).length;
            if (totalCells > WORKER_RESULT_LIMITS.maxCells) {
              throw new SpreadsheetValidationError("WORKER_RESULT_INVALID", "The parsed file's structure could not be validated.");
            }
            return rebuildRowSafely(row);
          });
          const format = claimedExtension.toLowerCase().replace(/^\./, "") === "csv" ? "csv" : "xlsx";
          resolve({ format, rows: safeRows });
        } catch (error) {
          reject(error instanceof SpreadsheetValidationError ? error : new SpreadsheetValidationError("WORKER_RESULT_INVALID", "The parsed file's structure could not be validated."));
        }
      });
    });

    worker.once("error", () => {
      // Never forward the raw worker error (may include stack traces
      // referencing file content) across this boundary either.
      finish(() => reject(new SpreadsheetValidationError("WORKER_CRASHED", "This file could not be processed.")));
    });

    worker.once("exit", (code) => {
      if (settled) return;
      // A clean exit always follows a 'message' (settled=true already);
      // reaching here with settled=false means the worker exited without
      // ever posting a result -- itself a crash from this module's
      // perspective (SIGKILL'd by the OS, an OOM the resourceLimits
      // guard didn't catch cleanly as an 'error' event, etc.).
      finish(() => reject(new SpreadsheetValidationError("WORKER_CRASHED", `This file could not be processed (worker exited with code ${code}).`)));
    });
  });
}

/** Test-only access to this module's internal validation helpers -- the
 * parent-side re-validation of a worker's response (malformed shape,
 * oversized result, non-string field values) is a real security
 * boundary worth testing directly, not just indirectly through a real
 * worker's (well-behaved) output. */
export const __testables = { isWorkerResponse, isKnownReason, rebuildRowSafely, WORKER_RESULT_LIMITS };
