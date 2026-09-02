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

import { requirePermission } from "@/lib/auth-guards";
import { POST } from "@/app/api/import/route";

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
  form.set("type", extra.type ?? "members");
  form.set("mapping", extra.mapping ?? "{}");
  for (const [key, value] of Object.entries(extra)) {
    if (key === "type" || key === "mapping") continue;
    form.set(key, value);
  }
  return new Request("https://portal.test/api/import", { method: "POST", body: form });
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
  });

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
  });

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
  });

  it("still enforces authorization first -- an unauthorized caller is rejected on its own merits, not confused with a rate-limit response", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));
    const file = new File(["First Name\nJane\n"], "members.csv", { type: "text/csv" });
    const response = await POST(makeRequest(file));
    expect(response.status).not.toBe(429);
    expect(response.status).not.toBe(200);
  });
});
