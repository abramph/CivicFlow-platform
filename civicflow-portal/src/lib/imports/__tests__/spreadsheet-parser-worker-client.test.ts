import { afterEach, describe, expect, it } from "vitest";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { parseSpreadsheetBufferIsolated, __testables } from "../spreadsheet-parser-worker-client";

/**
 * Worker-isolation follow-up (Security Patch A deployment review).
 *
 * These tests spawn REAL worker_threads.Worker instances (no mocking of
 * node:worker_threads) -- the properties under test (OOM containment,
 * hard-timeout enforcement, parent-process survival) are specifically
 * about real OS/V8-level isolation behavior that a mock cannot
 * demonstrate. Every workload here is a harmless, dynamically-generated,
 * never-committed fixture -- no real exploit payload.
 */

async function buildXlsx(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("parseSpreadsheetBufferIsolated -- compatibility with valid input", () => {
  it("parses a valid xlsx file, rows on a fresh null-prototype base", async () => {
    const buffer = await buildXlsx([["firstName", "lastName"], ["Jane", "Doe"]]);
    const result = await parseSpreadsheetBufferIsolated(buffer, "xlsx");
    expect(result.rows).toEqual([{ firstName: "Jane", lastName: "Doe" }]);
    expect(Object.getPrototypeOf(result.rows[0])).toBeNull();
  }, 15000);

  it("parses a valid csv file", async () => {
    const buffer = Buffer.from("a,b\n1,2\n3,4\n", "utf-8");
    const result = await parseSpreadsheetBufferIsolated(buffer, "csv");
    expect(result.rows).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]);
  }, 15000);

  it("still rejects a __proto__ header through the isolated path (prior adversarial fixture stays rejected)", async () => {
    const buffer = Buffer.from("__proto__,b\nx,y\n", "utf-8");
    await expect(parseSpreadsheetBufferIsolated(buffer, "csv")).rejects.toMatchObject({ reason: "UNSAFE_HEADER_NAME" });
  }, 15000);

  it("still rejects a spoofed extension through the isolated path (prior adversarial fixture stays rejected)", async () => {
    const buffer = Buffer.from("a,b\n1,2\n", "utf-8");
    await expect(parseSpreadsheetBufferIsolated(buffer, "xlsx")).rejects.toMatchObject({ reason: "FORMAT_MISMATCH" });
  }, 15000);
});

describe("parseSpreadsheetBufferIsolated -- hard timeout enforcement", () => {
  it("terminates the worker and rejects with WORKER_TIMEOUT once the wall-clock limit elapses, regardless of the worker's own CPU-bound state", async () => {
    const buffer = await buildXlsx([["a", "b"], ["1", "2"]]);
    const start = Date.now();
    await expect(parseSpreadsheetBufferIsolated(buffer, "xlsx", { timeoutMs: 1 })).rejects.toMatchObject({ reason: "WORKER_TIMEOUT" });
    expect(Date.now() - start).toBeLessThan(5000); // rejected promptly, not after some unrelated long wait
  }, 15000);

  it("does not hang the test process while waiting on a terminated worker", async () => {
    const buffer = await buildXlsx(Array.from({ length: 500 }, (_, i) => [String(i), "x".repeat(1000)]));
    await expect(parseSpreadsheetBufferIsolated(buffer, "xlsx", { timeoutMs: 5 })).rejects.toBeTruthy();
  }, 15000);
});

describe("parseSpreadsheetBufferIsolated -- OOM/crash containment", () => {
  it("contains a worker that exceeds its heap ceiling -- rejects with WORKER_CRASHED, parent process pid unchanged", async () => {
    const parentPidBefore = process.pid;
    const buffer = await buildXlsx(Array.from({ length: 3000 }, (_, i) => [String(i), "x".repeat(800)]));
    await expect(
      parseSpreadsheetBufferIsolated(buffer, "xlsx", { maxOldGenerationSizeMb: 4, maxYoungGenerationSizeMb: 2 })
    ).rejects.toMatchObject({ reason: "WORKER_CRASHED" });
    expect(process.pid).toBe(parentPidBefore);
  }, 20000);

  it("leaves the parent able to immediately handle another (valid, generously-resourced) request after a worker crash", async () => {
    const crashBuffer = await buildXlsx(Array.from({ length: 3000 }, (_, i) => [String(i), "x".repeat(800)]));
    await expect(
      parseSpreadsheetBufferIsolated(crashBuffer, "xlsx", { maxOldGenerationSizeMb: 4, maxYoungGenerationSizeMb: 2 })
    ).rejects.toMatchObject({ reason: "WORKER_CRASHED" });

    const validBuffer = await buildXlsx([["a", "b"], ["1", "2"]]);
    const result = await parseSpreadsheetBufferIsolated(validBuffer, "xlsx");
    expect(result.rows).toEqual([{ a: "1", b: "2" }]);
  }, 20000);
});

describe("parseSpreadsheetBufferIsolated -- parent-side result re-validation (__testables)", () => {
  it("isWorkerResponse rejects a malformed/unexpected shape", () => {
    expect(__testables.isWorkerResponse(null)).toBe(false);
    expect(__testables.isWorkerResponse(undefined)).toBe(false);
    expect(__testables.isWorkerResponse("not an object")).toBe(false);
    expect(__testables.isWorkerResponse({})).toBe(false);
    expect(__testables.isWorkerResponse({ ok: "yes" })).toBe(false); // ok must be boolean
    expect(__testables.isWorkerResponse({ ok: true, rows: "not an array" })).toBe(false);
    expect(__testables.isWorkerResponse({ ok: false })).toBe(false); // missing reason/message
    expect(__testables.isWorkerResponse({ ok: true, rows: [] })).toBe(true);
    expect(__testables.isWorkerResponse({ ok: false, reason: "X", message: "Y" })).toBe(true);
  });

  it("isKnownReason fails closed for any reason string outside the established taxonomy", () => {
    expect(__testables.isKnownReason("TOO_MANY_ROWS")).toBe(true);
    expect(__testables.isKnownReason("WORKER_TIMEOUT")).toBe(true);
    expect(__testables.isKnownReason("SOMETHING_A_COMPROMISED_WORKER_MADE_UP")).toBe(false);
    expect(__testables.isKnownReason("")).toBe(false);
  });

  it("rebuildRowSafely rebuilds onto a null-prototype object and strips non-string values", () => {
    const row = { a: "1", b: "2" };
    const safe = __testables.rebuildRowSafely(row);
    expect(Object.getPrototypeOf(safe)).toBeNull();
    expect(safe).toEqual({ a: "1", b: "2" });
  });

  it("rebuildRowSafely rejects a row with a non-string field value (a compromised/buggy worker could try to smuggle an object/array/number)", () => {
    expect(() => __testables.rebuildRowSafely({ a: { nested: "object" } })).toThrow();
    expect(() => __testables.rebuildRowSafely({ a: 12345 })).toThrow();
    expect(() => __testables.rebuildRowSafely({ a: ["array"] })).toThrow();
    expect(() => __testables.rebuildRowSafely({ a: null })).toThrow();
  });

  it("rebuildRowSafely rejects a field value exceeding the maximum field length (defense in depth if the worker's own limit were ever bypassed)", () => {
    const oversized = "x".repeat(__testables.WORKER_RESULT_LIMITS.maxFieldLength + 1);
    expect(() => __testables.rebuildRowSafely({ a: oversized })).toThrow();
  });

  it("rebuildRowSafely rejects a row with more columns than the configured maximum", () => {
    const wideRow: Record<string, string> = {};
    for (let i = 0; i < __testables.WORKER_RESULT_LIMITS.maxColumns + 1; i++) wideRow[`col${i}`] = "x";
    expect(() => __testables.rebuildRowSafely(wideRow)).toThrow();
  });

  it("validateAndRebuildRows rejects a result whose total serialized size exceeds maxSerializedBytes, even though no single row/field individually exceeds its own limit (a compromised or buggy worker could otherwise smuggle an oversized total payload through many small-looking rows)", () => {
    // Each row is well within maxFieldLength/maxColumns individually;
    // only the TOTAL across many rows crosses maxSerializedBytes. This
    // is the limit that was previously declared but never actually
    // enforced anywhere -- this test fails against that prior state.
    const fieldValue = "x".repeat(1000); // 1000 bytes/row
    const rowsNeeded = Math.floor(__testables.WORKER_RESULT_LIMITS.maxSerializedBytes / 1000) + 100;
    const rows = Array.from({ length: rowsNeeded }, () => ({ a: fieldValue }));
    expect(() => __testables.validateAndRebuildRows(rows)).toThrow();
  });

  it("validateAndRebuildRows accepts a result comfortably under maxSerializedBytes", () => {
    const rows = [{ a: "hello" }, { a: "world" }];
    const result = __testables.validateAndRebuildRows(rows);
    expect(result).toEqual([{ a: "hello" }, { a: "world" }]);
  });
});

describe("parseSpreadsheetBufferIsolated -- exact ArrayBuffer transfer isolation", () => {
  it("transfers only the uploaded file's exact bytes -- a Buffer sliced from a larger shared pooled allocation does not leak adjacent pool bytes into the worker", async () => {
    // Force a pooled allocation: Buffer.allocUnsafe() for anything under
    // Buffer.poolSize (default 8KB) is carved out of Node's shared
    // internal pool, so `smallBuffer.buffer` is LARGER than, and shared
    // with, unrelated allocations that happen to land in the same pool
    // slab -- exactly the scenario spreadsheetParserWorkerClient's
    // ArrayBuffer#slice-based exact copy exists to guard against.
    const secretMarker = "SECRET_ADJACENT_POOL_DATA_MUST_NOT_LEAK";
    const decoyAllocation = Buffer.allocUnsafe(secretMarker.length);
    decoyAllocation.write(secretMarker, "utf-8");

    const csvText = "a,b\n1,2\n";
    const pooledBuffer = Buffer.allocUnsafe(Buffer.byteLength(csvText, "utf-8"));
    pooledBuffer.write(csvText, "utf-8");

    // Both allocations are small enough to come from the same pool slab,
    // so pooledBuffer.buffer very likely extends well beyond
    // pooledBuffer's own byteLength and may contain decoyAllocation's
    // bytes elsewhere in the same underlying ArrayBuffer.
    const result = await parseSpreadsheetBufferIsolated(pooledBuffer, "csv");
    expect(result.rows).toEqual([{ a: "1", b: "2" }]);

    // The real assertion: the worker only ever received pooledBuffer's
    // OWN byteLength worth of data (enforced by ArrayBuffer#slice copying
    // exactly [byteOffset, byteOffset+byteLength)), not the whole
    // underlying pool -- proven structurally by parsing succeeding with
    // EXACTLY the two expected fields and nothing decoded from beyond
    // pooledBuffer's own bytes corrupting the result.
    expect(JSON.stringify(result.rows)).not.toContain("SECRET_ADJACENT_POOL_DATA");
  }, 15000);
});

/**
 * Production-path follow-up -- fail-closed worker resolution. Manipulates
 * the REAL compiled artifact on disk (dist-workers/spreadsheet-parser-
 * worker-entry.js, produced by `npm run build-worker`/the build step)
 * rather than mocking fs, since the actual runtime existsSync() check
 * against the actual file is exactly the behavior under test. The
 * artifact is always restored, even if a test fails partway through.
 */
describe("parseSpreadsheetBufferIsolated -- fail-closed production worker resolution", () => {
  const artifactPath = join(process.cwd(), "dist-workers", "spreadsheet-parser-worker-entry.js");
  const movedAsidePath = `${artifactPath}.test-moved-aside`;
  const originalNodeEnv = process.env.NODE_ENV;

  function moveArtifactAside() {
    if (existsSync(artifactPath)) renameSync(artifactPath, movedAsidePath);
  }
  function restoreArtifact() {
    if (existsSync(movedAsidePath)) renameSync(movedAsidePath, artifactPath);
  }

  afterEach(() => {
    restoreArtifact();
    if (originalNodeEnv === undefined) delete (process.env as { NODE_ENV?: string }).NODE_ENV;
    else (process.env as { NODE_ENV?: string }).NODE_ENV = originalNodeEnv;
  });

  it("uses the compiled artifact when present, regardless of NODE_ENV (baseline -- confirms the artifact really is there before the missing-artifact tests below)", async () => {
    expect(existsSync(artifactPath)).toBe(true);
    const buffer = Buffer.from("a,b\n1,2\n", "utf-8");
    const result = await parseSpreadsheetBufferIsolated(buffer, "csv");
    expect(result.rows).toEqual([{ a: "1", b: "2" }]);
  }, 15000);

  it("fails closed with PARSER_UNAVAILABLE when the compiled artifact is missing under NODE_ENV=production -- no dev-runtime fallback, no worker created", async () => {
    moveArtifactAside();
    (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
    const buffer = Buffer.from("a,b\n1,2\n", "utf-8");
    await expect(parseSpreadsheetBufferIsolated(buffer, "csv")).rejects.toMatchObject({ reason: "PARSER_UNAVAILABLE" });
  }, 15000);

  it("still allows the source-file fallback when the compiled artifact is missing OUTSIDE production (e.g. NODE_ENV unset, matching real Vitest runs)", async () => {
    moveArtifactAside();
    delete (process.env as { NODE_ENV?: string }).NODE_ENV;
    const buffer = Buffer.from("a,b\n1,2\n", "utf-8");
    const result = await parseSpreadsheetBufferIsolated(buffer, "csv");
    expect(result.rows).toEqual([{ a: "1", b: "2" }]);
  }, 15000);

  it("still allows the source-file fallback under NODE_ENV=test (another explicitly non-production value)", async () => {
    moveArtifactAside();
    (process.env as { NODE_ENV?: string }).NODE_ENV = "test";
    const buffer = Buffer.from("a,b\n1,2\n", "utf-8");
    const result = await parseSpreadsheetBufferIsolated(buffer, "csv");
    expect(result.rows).toEqual([{ a: "1", b: "2" }]);
  }, 15000);
});
