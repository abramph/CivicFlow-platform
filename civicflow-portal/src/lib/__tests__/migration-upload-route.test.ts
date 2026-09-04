import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { LEGACY_XLS_MESSAGE } from "@/lib/imports/spreadsheet-parser";

/**
 * Security Patch A -- route-level coverage for POST /api/migration/upload,
 * proving the hardened spreadsheet-parser.ts wiring end-to-end (the real
 * parser runs against real file content -- not mocked). runMigrationImport
 * itself is mocked, matching this file's narrow purpose: parsing/format
 * validation, not the desktop-migration business logic covered elsewhere.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function orgAdminContext(): any {
  return { organizationId: "org-a", session: { userId: "officer-1", userEmail: "officer@example.com" } };
}

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requireRole: vi.fn().mockResolvedValue(orgAdminContext()) };
});

const runMigrationImport = vi.fn().mockResolvedValue({ members: 1 });
vi.mock("@/lib/migration-import", () => ({
  runMigrationImport: (...args: unknown[]) => runMigrationImport(...args),
}));

import { requireRole, UnauthenticatedError } from "@/lib/auth-guards";
import { POST } from "@/app/api/migration/upload/route";
import { withParseAdmission, resetParseAdmissionStateForTests } from "@/lib/imports/parse-admission";

async function buildXlsxFile(rows: string[][], filename = "export.xlsx"): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  for (const row of rows) ws.addRow(row);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return new File([new Uint8Array(buffer)], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function makeRequest(file: File): Request {
  const form = new FormData();
  form.set("file", file);
  return new Request("https://portal.test/api/migration/upload", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(orgAdminContext());
  runMigrationImport.mockResolvedValue({ members: 1 });
});

describe("POST /api/migration/upload -- hardened spreadsheet parsing", () => {
  it("imports a valid .xlsx member export end-to-end through the hardened parser", async () => {
    const file = await buildXlsxFile([["first name", "last name", "email"], ["Jane", "Doe", "jane@example.com"]]);
    const response = await POST(makeRequest(file));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(runMigrationImport).toHaveBeenCalledTimes(1);
    const data = runMigrationImport.mock.calls[0][1];
    expect(data.members[0]).toMatchObject({ first_name: "Jane", last_name: "Doe", email: "jane@example.com" });
  });

  it("imports a valid CSV file end-to-end", async () => {
    const file = new File(["first name,last name\nJane,Doe\n"], "export.csv", { type: "text/csv" });
    const response = await POST(makeRequest(file));
    expect(response.status).toBe(200);
    expect(runMigrationImport).toHaveBeenCalledTimes(1);
  });

  it("rejects a legacy .xls file with the exact conversion message, and attempts no import", async () => {
    const file = new File(["not a real xls file"], "export.xls", { type: "application/vnd.ms-excel" });
    const response = await POST(makeRequest(file));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error).toBe(LEGACY_XLS_MESSAGE);
    expect(runMigrationImport).not.toHaveBeenCalled();
  });

  it("does not treat a renamed arbitrary file as a valid legacy workbook -- a .xls-named file with executable content is still rejected on the claimed extension alone, never parsed", async () => {
    const file = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], "totally-not-a-workbook.xls", { type: "application/vnd.ms-excel" });
    const response = await POST(makeRequest(file));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error).toBe(LEGACY_XLS_MESSAGE);
    expect(runMigrationImport).not.toHaveBeenCalled();
  });

  it("rejects a spoofed extension -- CSV content renamed to .xlsx", async () => {
    const file = new File(["first name,last name\nJane,Doe\n"], "export.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const response = await POST(makeRequest(file));
    expect(response.status).toBe(400);
    expect(runMigrationImport).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file extension outright", async () => {
    const file = new File(["whatever"], "export.exe", { type: "application/octet-stream" });
    const response = await POST(makeRequest(file));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/unsupported file type/i);
    expect(runMigrationImport).not.toHaveBeenCalled();
  });

  it("rejects a __proto__ header with no import attempted", async () => {
    const file = new File(["__proto__,last name\nx,Doe\n"], "export.csv", { type: "text/csv" });
    const response = await POST(makeRequest(file));
    expect(response.status).toBe(400);
    expect(runMigrationImport).not.toHaveBeenCalled();
  });

  it("never exposes a raw internal exception message in the response for an unexpected parse failure", async () => {
    // A genuinely malformed ZIP claiming to be .xlsx -- the response body
    // must be the parser's own safe message, never a raw stack/exception.
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])], "export.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const response = await POST(makeRequest(file));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error).not.toMatch(/at .*\(.*:\d+:\d+\)/); // no stack-trace-shaped text
    expect(runMigrationImport).not.toHaveBeenCalled();
  });

  it("enforces the ORG_ADMIN role gate before parsing", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));
    const file = await buildXlsxFile([["first name"], ["Jane"]]);
    const response = await POST(makeRequest(file));
    expect(response.status).not.toBe(200);
    expect(runMigrationImport).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After and runs no migration import when this organization already has a parse in flight (worker-isolation follow-up)", async () => {
    resetParseAdmissionStateForTests();
    const holdOpen = new Promise<void>(() => {});
    withParseAdmission("org-a", () => holdOpen).catch(() => {});
    await new Promise((r) => setTimeout(r, 10));

    const file = await buildXlsxFile([["first name"], ["Jane"]]);
    const response = await POST(makeRequest(file));
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(payload.ok).toBe(false);
    expect(runMigrationImport).not.toHaveBeenCalled();

    resetParseAdmissionStateForTests();
  });
});

/**
 * Auth-ordering follow-up -- this route's auth ordering (requireRole runs
 * before formData()) was already correct; only the content-type check and
 * safe malformed-multipart handling were added.
 */
describe("POST /api/migration/upload -- auth-before-parse ordering (auth-ordering follow-up)", () => {
  let formDataSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    formDataSpy = vi.spyOn(Request.prototype, "formData");
  });

  afterEach(() => {
    formDataSpy.mockRestore();
  });

  it("returns 401 for an unauthenticated request and never calls request.formData()", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new UnauthenticatedError());
    const file = await buildXlsxFile([["first name"], ["Jane"]]);
    const response = await POST(makeRequest(file));
    expect(response.status).toBe(401);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(runMigrationImport).not.toHaveBeenCalled();
  });

  it("checks the declared Content-Length before parsing and rejects an oversized request with 413 without calling request.formData() (malformed-request-behavior follow-up)", async () => {
    const response = await POST(
      new Request("https://portal.test/api/migration/upload", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(101 * 1024 * 1024) },
        body: "irrelevant -- rejected on the declared length before this body is ever read",
      })
    );
    expect(response.status).toBe(413);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(runMigrationImport).not.toHaveBeenCalled();
  });

  it("also returns 413 (not 400) for the post-parse actual-byte-size backstop, when a dishonest/absent Content-Length let an oversized body through to formData()", async () => {
    // Same underlying bug as the declared-length check above: this branch
    // used to `throw new ValidationError(...)`, whose status is hardcoded
    // to 400 in validation.ts, silently downgrading what should be 413.
    const bigFile = new File([new Uint8Array(101 * 1024 * 1024)], "export.csv", { type: "text/csv" });
    const response = await POST(makeRequest(bigFile));
    const payload = await response.json();
    expect(response.status).toBe(413);
    expect(payload.error).toBeTruthy();
    expect(runMigrationImport).not.toHaveBeenCalled();
  });

  it("checks Content-Type before parsing and rejects a non-multipart request with 415 without calling request.formData()", async () => {
    const response = await POST(
      new Request("https://portal.test/api/migration/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: "nope" }) })
    );
    const payload = await response.json();
    expect(response.status).toBe(415);
    expect(payload.error).toBeTruthy();
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(runMigrationImport).not.toHaveBeenCalled();
  });

  it("returns a safe 400 (not 500) for a malformed multipart body with a claimed multipart content type", async () => {
    const response = await POST(
      new Request("https://portal.test/api/migration/upload", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body: "not valid multipart data" })
    );
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error).toBeTruthy();
    expect(runMigrationImport).not.toHaveBeenCalled();
  });

  it("returns a safe 400 for a well-formed multipart request with no file field", async () => {
    const form = new FormData();
    const response = await POST(new Request("https://portal.test/api/migration/upload", { method: "POST", body: form }));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error).toBeTruthy();
    expect(runMigrationImport).not.toHaveBeenCalled();
  });
});
