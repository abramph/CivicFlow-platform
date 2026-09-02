import { parentPort, workerData } from "node:worker_threads";
import { parseSpreadsheetBuffer, SpreadsheetValidationError } from "./spreadsheet-parser";

/**
 * Worker-isolation follow-up (Security Patch A deployment review) --
 * this file runs INSIDE a worker_threads Worker, never in the main
 * Next.js process. It is compiled to plain CommonJS by
 * scripts/build-worker.mjs (see that file's header comment for why) and
 * must stay free of any `@/...` path-alias import or project dependency
 * beyond spreadsheet-parser.ts itself -- no Prisma client, no session,
 * no filesystem target, no network client, nothing that would give a
 * malicious file's parse a way to reach anything beyond its own bytes.
 *
 * Message contract (parent -> worker, via `workerData` at construction --
 * a worker_threads Worker cannot be reused across requests in this
 * design, so there is exactly one message in and one message out):
 *   workerData: { buffer: ArrayBuffer; claimedExtension: string }
 *
 * Response contract (worker -> parent, via a single postMessage):
 *   { ok: true; rows: Record<string, string>[] }
 *   { ok: false; reason: string; message: string }
 *
 * Deliberately plain data only -- an array of plain row objects and
 * strings. No class instances, no ExcelJS Workbook/Worksheet objects, no
 * formulas, nothing that structured clone would need to reconstruct
 * beyond arrays/objects/strings. The parent re-validates and rebuilds
 * every row on a null-prototype base again on receipt (see
 * spreadsheet-parser-worker-client.ts) -- structured clone does not
 * preserve Object.create(null), confirmed directly, not assumed.
 */

interface WorkerRequest {
  buffer: ArrayBuffer;
  claimedExtension: string;
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

async function run(): Promise<void> {
  if (!parentPort) {
    throw new Error("spreadsheet-parser-worker-entry must run inside a worker_threads Worker.");
  }

  const { buffer, claimedExtension } = workerData as WorkerRequest;

  try {
    const nodeBuffer = Buffer.from(buffer);
    const { rows } = await parseSpreadsheetBuffer(nodeBuffer, claimedExtension);
    const response: WorkerSuccessResponse = { ok: true, rows };
    parentPort.postMessage(response);
  } catch (error) {
    const response: WorkerFailureResponse =
      error instanceof SpreadsheetValidationError
        ? { ok: false, reason: error.reason, message: error.message }
        // Never forward a raw internal exception's text across the worker
        // boundary -- same error-sanitization rule as the rest of this
        // module (see spreadsheet-parser.ts's own module comment).
        : { ok: false, reason: "MALFORMED_WORKBOOK", message: "This file could not be processed." };
    parentPort.postMessage(response);
  }
}

run();
