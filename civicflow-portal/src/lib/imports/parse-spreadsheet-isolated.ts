import { parseSpreadsheetBufferIsolated, type WorkerParseOptions } from "./spreadsheet-parser-worker-client";
import { withParseAdmission } from "./parse-admission";
import type { ParsedSpreadsheet } from "./spreadsheet-parser";

/**
 * Worker-isolation follow-up (Security Patch A deployment review).
 *
 * The single shared entry point all three upload routes
 * (/api/import, /api/imports, /api/migration/upload) use to turn an
 * untrusted uploaded buffer into rows: process-local admission control
 * (parse-admission.ts) gates entry BEFORE a worker is ever created, then
 * the actual parse runs isolated in a worker thread with an enforced
 * heap ceiling and a parent-side wall-clock timeout that can fire even
 * while the worker is CPU-bound (spreadsheet-parser-worker-client.ts).
 *
 * Callers must run their own authorization/session check before calling
 * this -- `organizationId` here is trusted as already-verified (it is
 * only ever used to scope admission fairness, not as an authorization
 * check itself).
 */
export async function parseUploadedSpreadsheet(
  buffer: Buffer,
  claimedExtension: string,
  organizationId: string,
  options?: WorkerParseOptions
): Promise<ParsedSpreadsheet> {
  return withParseAdmission(organizationId, () => parseSpreadsheetBufferIsolated(buffer, claimedExtension, options));
}

export { ParseAdmissionDeniedError } from "./parse-admission";
export { SpreadsheetValidationError } from "./spreadsheet-parser";
export type { ParsedSpreadsheet } from "./spreadsheet-parser";
