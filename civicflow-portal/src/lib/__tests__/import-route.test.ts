import { beforeEach, describe, expect, it, vi } from "vitest";
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
