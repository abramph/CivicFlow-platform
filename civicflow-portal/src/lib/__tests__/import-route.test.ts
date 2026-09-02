import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

/**
 * Security Patch A -- route-level coverage for POST /api/import, proving
 * the hardened spreadsheet-parser.ts wiring end-to-end (these tests do
 * NOT mock parseSpreadsheetBuffer -- the real parser runs against real
 * file content, same as production). RBAC/import-logic branches are
 * mocked, matching this file's narrow purpose: parsing and validation,
 * not re-testing member/PTA/HOA import business logic covered elsewhere.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function permissionContext(): any {
  return {
    session: { userId: "officer-1", userEmail: "officer@example.com" },
    organizationId: "org-a",
    role: "ORG_ADMIN",
    can: () => true,
  };
}

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requirePermission: vi.fn().mockResolvedValue(permissionContext()) };
});

vi.mock("@/lib/labs/pta/guard", () => ({
  requirePtaAccess: vi.fn().mockResolvedValue({ organizationId: "org-a", session: { userId: "officer-1", userEmail: "officer@example.com" } }),
}));

vi.mock("@/lib/hoa/guard", () => ({
  requireHoaPropertyWrite: vi.fn().mockResolvedValue({ organizationId: "org-a", session: { userId: "officer-1", userEmail: "officer@example.com" } }),
  requireHoaResidentWrite: vi.fn().mockResolvedValue({ organizationId: "org-a", session: { userId: "officer-1", userEmail: "officer@example.com" } }),
}));

const importMembers = vi.fn().mockResolvedValue([{ row: 2, status: "ok" }]);
vi.mock("@/lib/member-import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/member-import")>();
  return { ...actual, importMembers: (...args: unknown[]) => importMembers(...args) };
});

const importPtaHouseholds = vi.fn().mockResolvedValue([{ row: 2, status: "ok" }]);
const importHoaProperties = vi.fn().mockResolvedValue([{ row: 2, status: "ok" }]);
vi.mock("@/lib/vertical-import", () => ({
  importPtaHouseholds: (...args: unknown[]) => importPtaHouseholds(...args),
  importHoaProperties: (...args: unknown[]) => importHoaProperties(...args),
}));

import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { requirePermission, UnauthenticatedError, ForbiddenError } from "@/lib/auth-guards";
import { POST } from "@/app/api/import/route";
import { withParseAdmission, configureParseAdmissionForTests, resetParseAdmissionStateForTests } from "@/lib/imports/parse-admission";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function permissionContextForOrg(organizationId: string): any {
  return {
    session: { userId: "officer-1", userEmail: "officer@example.com" },
    organizationId,
    role: "ORG_ADMIN",
    can: () => true,
  };
}

async function buildXlsxFile(rows: string[][], filename = "members.xlsx"): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  for (const row of rows) ws.addRow(row);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return new File([new Uint8Array(buffer)], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function makeRequest(file: File, extra: Record<string, string> = {}): Request {
  const form = new FormData();
  form.set("file", file);
  form.set("mapping", extra.mapping ?? "{}");
  for (const [key, value] of Object.entries(extra)) {
    if (key === "type" || key === "mapping") continue;
    form.set(key, value);
  }
  // Auth-ordering follow-up -- `type` now travels as a query parameter, not
  // a form field, so the route can select the right permission check
  // before it ever calls request.formData(). See ImportPageClient.tsx's
  // real call sites, which build the URL the same way.
  const importType = extra.type ?? "members";
  return new Request(`https://portal.test/api/import?type=${encodeURIComponent(importType)}`, { method: "POST", body: form });
}

function makeRawRequest(init: { url?: string; headers?: Record<string, string>; body?: BodyInit | null; method?: string } = {}): Request {
  return new Request(init.url ?? "https://portal.test/api/import?type=members", {
    method: init.method ?? "POST",
    headers: init.headers,
    body: init.body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(permissionContext());
  importMembers.mockResolvedValue([{ row: 2, status: "ok" }]);
});

describe("POST /api/import -- hardened spreadsheet parsing", () => {
  it("previews a valid .xlsx file and returns its real headers via the hardened parser", async () => {
    const file = await buildXlsxFile([["First Name", "Last Name"], ["Jane", "Doe"]]);
    const response = await POST(makeRequest(file, { preview: "1" }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.headers).toEqual(["First Name", "Last Name"]);
    expect(payload.preview).toEqual([{ "First Name": "Jane", "Last Name": "Doe" }]);
    expect(importMembers).not.toHaveBeenCalled();
  });

  it("previews a valid CSV file", async () => {
    const file = new File(["First Name,Last Name\nJane,Doe\n"], "members.csv", { type: "text/csv" });
    const response = await POST(makeRequest(file, { preview: "1" }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.headers).toEqual(["First Name", "Last Name"]);
  });

  it("imports members from a real .xlsx file end-to-end", async () => {
    const file = await buildXlsxFile([["First Name", "Last Name"], ["Jane", "Doe"]]);
    const response = await POST(makeRequest(file, { mapping: JSON.stringify({ "First Name": "firstName", "Last Name": "lastName" }) }));
    expect(response.status).toBe(200);
    expect(importMembers).toHaveBeenCalledTimes(1);
    const rowsArg = importMembers.mock.calls[0][0];
    expect(rowsArg).toEqual([{ "First Name": "Jane", "Last Name": "Doe" }]);
  });

  it("rejects a spoofed extension -- CSV content renamed to .xlsx -- with no import attempted", async () => {
    const file = new File(["First Name,Last Name\nJane,Doe\n"], "members.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const response = await POST(makeRequest(file));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error).toBeTruthy();
    expect(importMembers).not.toHaveBeenCalled();
  });

  it("rejects a legacy .xls file (no longer accepted) with no import attempted", async () => {
    const file = new File(["not a real xls file"], "members.xls", { type: "application/vnd.ms-excel" });
    const response = await POST(makeRequest(file));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error).toBeTruthy();
    expect(importMembers).not.toHaveBeenCalled();
  });

  it("rejects an unrelated binary file (e.g. renamed executable) with no import attempted", async () => {
    const file = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], "totally-a-spreadsheet.csv", { type: "text/csv" });
    const response = await POST(makeRequest(file));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(importMembers).not.toHaveBeenCalled();
    void payload;
  });

  it("rejects a __proto__ header with no import attempted", async () => {
    const file = new File(["__proto__,Last Name\nx,Doe\n"], "members.csv", { type: "text/csv" });
    const response = await POST(makeRequest(file));
    expect(response.status).toBe(400);
    expect(importMembers).not.toHaveBeenCalled();
  });

  it("rejects duplicate normalized headers with no import attempted", async () => {
    const file = new File(["Name,name\nx,y\n"], "members.csv", { type: "text/csv" });
    const response = await POST(makeRequest(file));
    expect(response.status).toBe(400);
    expect(importMembers).not.toHaveBeenCalled();
  });

  it("enforces the permission gate before parsing -- a caller without members:write is rejected before the file is ever touched", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));
    const file = await buildXlsxFile([["First Name"], ["Jane"]]);
    const response = await POST(makeRequest(file));
    expect(response.status).not.toBe(200);
    expect(importMembers).not.toHaveBeenCalled();
  });

  it("dispatches PTA household imports through requirePtaAccess, not the generic members:write gate", async () => {
    const file = new File(["Household Name,School Year,Contact Name\nThe Doe Family,2026-2027,Jane Doe\n"], "households.csv", { type: "text/csv" });
    const response = await POST(
      makeRequest(file, { type: "pta-households", mapping: JSON.stringify({ "Household Name": "householdName", "School Year": "schoolYear", "Contact Name": "contactName" }) })
    );
    expect(response.status).toBe(200);
    expect(importPtaHouseholds).toHaveBeenCalledTimes(1);
    expect(importMembers).not.toHaveBeenCalled();
  });
});

/**
 * Security Patch A follow-up -- /api/import previously had no rate limit
 * at all despite doing the same expensive parsing work /api/imports
 * already limits. These tests exercise the REAL in-memory rate limiter
 * (not mocked -- rate-limit.ts is never mocked in this file), forced via
 * CIVICFLOW_USE_MEMORY_RATE_LIMITER so the counting/window logic itself
 * is genuinely proven, not just that some rate-limit function was called.
 */
describe("POST /api/import -- organization-scoped rate limiting (Security Patch A follow-up)", () => {
  const originalEnv = process.env.CIVICFLOW_USE_MEMORY_RATE_LIMITER;

  beforeEach(() => {
    process.env.CIVICFLOW_USE_MEMORY_RATE_LIMITER = "1";
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CIVICFLOW_USE_MEMORY_RATE_LIMITER;
    else process.env.CIVICFLOW_USE_MEMORY_RATE_LIMITER = originalEnv;
    vi.useRealTimers();
  });

  it("allows requests up to the limit, then rejects the next one with 429 and never invokes the parser/importer on the rejected request", async () => {
    const org = `rl-test-org-${Math.random()}`;
    vi.mocked(requirePermission).mockResolvedValue(permissionContextForOrg(org));

    for (let i = 0; i < 20; i++) {
      const file = new File([`First Name\nJane${i}\n`], "members.csv", { type: "text/csv" });
      const response = await POST(makeRequest(file));
      expect(response.status).toBe(200);
    }
    importMembers.mockClear();

    const file21 = new File(["First Name\nJane21\n"], "members.csv", { type: "text/csv" });
    const response21 = await POST(makeRequest(file21));
    const payload21 = await response21.json();

    expect(response21.status).toBe(429);
    expect(response21.headers.get("Retry-After")).toBeTruthy();
    expect(payload21.ok).toBe(false);
    expect(importMembers).not.toHaveBeenCalled();
  }, 30000); // worker-isolation follow-up -- 20 requests each spawn a real worker thread; the default 5s timeout isn't enough headroom under full-suite CPU contention

  it("does not let one organization's usage exhaust a different organization's allowance", async () => {
    const orgA = `rl-test-org-a-${Math.random()}`;
    const orgB = `rl-test-org-b-${Math.random()}`;

    vi.mocked(requirePermission).mockResolvedValue(permissionContextForOrg(orgA));
    for (let i = 0; i < 20; i++) {
      const file = new File([`First Name\nJane${i}\n`], "members.csv", { type: "text/csv" });
      const response = await POST(makeRequest(file));
      expect(response.status).toBe(200);
    }
    // org A is now exhausted
    const orgAOverLimit = await POST(makeRequest(new File(["First Name\nX\n"], "members.csv", { type: "text/csv" })));
    expect(orgAOverLimit.status).toBe(429);

    // org B, first request, should still succeed
    vi.mocked(requirePermission).mockResolvedValue(permissionContextForOrg(orgB));
    const orgBFirst = await POST(makeRequest(new File(["First Name\nJane\n"], "members.csv", { type: "text/csv" })));
    expect(orgBFirst.status).toBe(200);
  }, 30000);

  it("resets the allowance after the window elapses", async () => {
    vi.useFakeTimers();
    const org = `rl-test-org-window-${Math.random()}`;
    vi.mocked(requirePermission).mockResolvedValue(permissionContextForOrg(org));

    for (let i = 0; i < 20; i++) {
      const file = new File([`First Name\nJane${i}\n`], "members.csv", { type: "text/csv" });
      const response = await POST(makeRequest(file));
      expect(response.status).toBe(200);
    }
    const exhausted = await POST(makeRequest(new File(["First Name\nX\n"], "members.csv", { type: "text/csv" })));
    expect(exhausted.status).toBe(429);

    vi.advanceTimersByTime(61_000); // just past the 60s window

    const afterWindow = await POST(makeRequest(new File(["First Name\nY\n"], "members.csv", { type: "text/csv" })));
    expect(afterWindow.status).toBe(200);
  }, 30000);

  it("still enforces authorization first -- an unauthorized caller is rejected on its own merits, not confused with a rate-limit response", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));
    const file = new File(["First Name\nJane\n"], "members.csv", { type: "text/csv" });
    const response = await POST(makeRequest(file));
    expect(response.status).not.toBe(429);
    expect(response.status).not.toBe(200);
  });
});

describe("POST /api/import -- worker-isolation admission control (worker-isolation follow-up)", () => {
  const originalEnv = process.env.CIVICFLOW_USE_MEMORY_RATE_LIMITER;

  beforeEach(() => {
    process.env.CIVICFLOW_USE_MEMORY_RATE_LIMITER = "1";
    resetParseAdmissionStateForTests();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CIVICFLOW_USE_MEMORY_RATE_LIMITER;
    else process.env.CIVICFLOW_USE_MEMORY_RATE_LIMITER = originalEnv;
    resetParseAdmissionStateForTests();
  });

  it("returns 429 with Retry-After and never invokes the importer when the same organization already has a parse in flight -- distinct from, and checked separately from, the request-rate limiter above", async () => {
    const org = `admission-test-org-${Math.random()}`;
    vi.mocked(requirePermission).mockResolvedValue(permissionContextForOrg(org));

    const holdOpen = new Promise<void>(() => {}); // never resolves for the life of this test
    const releaseSlotPromise = withParseAdmission(org, () => holdOpen).catch(() => {});
    await new Promise((r) => setTimeout(r, 10)); // let the slot actually get acquired

    const file = new File(["First Name\nJane\n"], "members.csv", { type: "text/csv" });
    const response = await POST(makeRequest(file));
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(payload.ok).toBe(false);
    expect(importMembers).not.toHaveBeenCalled();

    void releaseSlotPromise; // slot is released automatically when this test's admission state resets
  });

  it("still enforces authorization before admission control -- an unauthorized caller is rejected on its own merits even while the admission slot is occupied", async () => {
    const org = `admission-test-org-authz-${Math.random()}`;
    const holdOpen = new Promise<void>(() => {});
    withParseAdmission(org, () => holdOpen).catch(() => {});
    await new Promise((r) => setTimeout(r, 10));

    vi.mocked(requirePermission).mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));
    const file = new File(["First Name\nJane\n"], "members.csv", { type: "text/csv" });
    const response = await POST(makeRequest(file));
    expect(response.status).not.toBe(429);
    expect(importMembers).not.toHaveBeenCalled();
  });

  it("does not deny an unrelated organization merely because a different organization's slot is occupied (global capacity allows a second)", async () => {
    configureParseAdmissionForTests({ maxConcurrent: 2, maxQueueLength: 2, retryAfterSeconds: 5 });
    const busyOrg = `admission-test-busy-${Math.random()}`;
    const freeOrg = `admission-test-free-${Math.random()}`;

    const holdOpen = new Promise<void>(() => {});
    withParseAdmission(busyOrg, () => holdOpen).catch(() => {});
    await new Promise((r) => setTimeout(r, 10));

    vi.mocked(requirePermission).mockResolvedValue(permissionContextForOrg(freeOrg));
    const file = new File(["First Name\nJane\n"], "members.csv", { type: "text/csv" });
    const response = await POST(makeRequest(file));
    expect(response.status).toBe(200);
  });
});

describe("POST /api/import -- fails closed with no mutation when the compiled worker artifact is unavailable in production (production-path follow-up)", () => {
  const artifactPath = join(process.cwd(), "dist-workers", "spreadsheet-parser-worker-entry.js");
  const movedAsidePath = `${artifactPath}.route-test-moved-aside`;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    if (existsSync(artifactPath)) renameSync(artifactPath, movedAsidePath);
    (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
  });

  afterEach(() => {
    if (existsSync(movedAsidePath)) renameSync(movedAsidePath, artifactPath);
    if (originalNodeEnv === undefined) delete (process.env as { NODE_ENV?: string }).NODE_ENV;
    else (process.env as { NODE_ENV?: string }).NODE_ENV = originalNodeEnv;
  });

  it("returns a clean rejection and never invokes the importer when the compiled worker artifact is missing under NODE_ENV=production", async () => {
    const file = new File(["First Name\nJane\n"], "members.csv", { type: "text/csv" });
    const response = await POST(makeRequest(file));
    expect(response.status).toBe(400);
    expect(importMembers).not.toHaveBeenCalled();
  });
});

/**
 * Auth-ordering follow-up -- proves the actual ordering, not just the
 * final status code. Every "before parsing" assertion here spies on
 * Request.prototype.formData directly, so a future regression that moves
 * formData() back above auth/rate-limit/content checks fails these tests
 * even if it happens to still return the same status code.
 */
describe("POST /api/import -- auth-before-parse ordering (auth-ordering follow-up)", () => {
  let formDataSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    formDataSpy = vi.spyOn(Request.prototype, "formData");
  });

  afterEach(() => {
    formDataSpy.mockRestore();
  });

  it("returns 401 for an unauthenticated multipart request and never calls request.formData()", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new UnauthenticatedError());
    const file = new File(["First Name\nJane\n"], "members.csv", { type: "text/csv" });
    const response = await POST(makeRequest(file));
    expect(response.status).toBe(401);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(importMembers).not.toHaveBeenCalled();
  });

  it("returns 401 for an unauthenticated non-multipart (e.g. empty) request and never calls request.formData()", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new UnauthenticatedError());
    const response = await POST(makeRawRequest({ headers: { "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(401);
    expect(formDataSpy).not.toHaveBeenCalled();
  });

  it("returns 403 for an unauthorized caller and never calls request.formData()", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new ForbiddenError());
    const file = new File(["First Name\nJane\n"], "members.csv", { type: "text/csv" });
    const response = await POST(makeRequest(file));
    expect(response.status).toBe(403);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(importMembers).not.toHaveBeenCalled();
  });

  it("checks Content-Length before parsing and rejects an oversized declared length with 413 without calling request.formData()", async () => {
    const response = await POST(
      makeRawRequest({
        headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(51 * 1024 * 1024) },
        body: "irrelevant -- rejected on the declared length before this body is ever read",
      })
    );
    const payload = await response.json();
    expect(response.status).toBe(413);
    expect(payload.error).toBeTruthy();
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(importMembers).not.toHaveBeenCalled();
  });

  it("checks Content-Type before parsing and rejects a non-multipart request with 415 without calling request.formData()", async () => {
    const response = await POST(
      makeRawRequest({ headers: { "content-type": "application/json" }, body: JSON.stringify({ file: "not-a-real-upload" }) })
    );
    const payload = await response.json();
    expect(response.status).toBe(415);
    expect(payload.error).toBeTruthy();
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(importMembers).not.toHaveBeenCalled();
  });

  it("returns a safe 400 (not 500) for a malformed multipart body with a claimed multipart content type", async () => {
    const response = await POST(
      makeRawRequest({ headers: { "content-type": "multipart/form-data; boundary=x" }, body: "this is not valid multipart data" })
    );
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error).toBeTruthy();
    expect(importMembers).not.toHaveBeenCalled();
  });

  it("returns a safe 400 for an authenticated, well-formed multipart request with no file field", async () => {
    const form = new FormData();
    form.set("mapping", "{}");
    const response = await POST(new Request("https://portal.test/api/import?type=members", { method: "POST", body: form }));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error).toBeTruthy();
    expect(importMembers).not.toHaveBeenCalled();
  });
});
