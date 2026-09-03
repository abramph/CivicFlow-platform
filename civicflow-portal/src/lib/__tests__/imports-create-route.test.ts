import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEGACY_XLS_MESSAGE } from "@/lib/imports/spreadsheet-parser";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function permissionContext(allowed: string[]): any {
  return {
    session: { userId: "officer-1", userEmail: "officer@example.com" },
    organizationId: "org-a",
    role: "ORG_ADMIN",
    can: (permission: string) => allowed.includes(permission),
  };
}

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue(permissionContext(["imports:create", "members:write"])),
  };
});

const requirePtaVertical = vi.fn().mockResolvedValue({ primaryVertical: "PTA", status: "active" });
vi.mock("@/lib/labs/pta/guard", () => ({
  requirePtaVertical: (...args: unknown[]) => requirePtaVertical(...args),
}));

const requireHoaCapability = vi.fn().mockResolvedValue({ primaryVertical: "HOA", status: "active" });
vi.mock("@/lib/hoa/guard", () => ({
  requireHoaCapability: (...args: unknown[]) => requireHoaCapability(...args),
}));

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const findFirstImportBatch = vi.fn();
const createImportBatch = vi.fn();
const updateImportBatch = vi.fn();
const findManyImportBatch = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    importBatch: {
      findFirst: (...args: unknown[]) => findFirstImportBatch(...args),
      create: (...args: unknown[]) => createImportBatch(...args),
      update: (...args: unknown[]) => updateImportBatch(...args),
      findMany: (...args: unknown[]) => findManyImportBatch(...args),
    },
  },
}));

const findExistingBatchByHash = vi.fn();
vi.mock("@/lib/imports/file-identity", () => ({
  hashFileBuffer: () => "fake-hash",
  findExistingBatchByHash: (...args: unknown[]) => findExistingBatchByHash(...args),
}));

const uploadImportSourceFile = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/imports/storage", () => ({
  buildImportSourceObjectKey: () => "organizations/org-a/imports/batch-1/source/x.csv",
  computeImportRetentionDate: (d: Date) => d,
  uploadImportSourceFile: (...args: unknown[]) => uploadImportSourceFile(...args),
}));

const analyzeBatch = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/imports/engine", () => ({
  analyzeBatch: (...args: unknown[]) => analyzeBatch(...args),
}));

import { requirePermission, UnauthenticatedError } from "@/lib/auth-guards";
import { requireRateLimit } from "@/lib/rate-limit";
import { POST as createPOST } from "@/app/api/imports/route";
import { withParseAdmission, resetParseAdmissionStateForTests } from "@/lib/imports/parse-admission";

function makeUploadRequest(mapping: Record<string, string>, kind?: string, csvContent = "First Name,Last Name\nJane,Doe\n") {
  const form = new FormData();
  form.set("file", new File([csvContent], "members.csv", { type: "text/csv" }));
  form.set("mapping", JSON.stringify(mapping));
  if (kind) form.set("kind", kind);
  return new Request("https://portal.test/api/imports", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  // mockReset (not just clearAllMocks' implicit clear) so a queued
  // mockResolvedValueOnce a previous test never consumed (e.g. the
  // forceNewAnalysis test below, which intentionally skips calling this)
  // can never leak into the next test that does call it.
  findExistingBatchByHash.mockReset().mockResolvedValue(null);
  createImportBatch.mockResolvedValue({ id: "batch-1", uploadedAt: new Date("2026-01-01T00:00:00Z") });
  updateImportBatch.mockResolvedValue({ id: "batch-1" });
});

describe("POST /api/imports", () => {
  it("rejects a mapping where neither firstName nor lastName was mapped to any column", async () => {
    // Regression test: columnMapping is keyed by source header and valued by
    // canonical field (mapping[header] = field) -- checking columnMapping.firstName
    // directly (a key lookup) previously always failed even when firstName
    // WAS mapped, because "firstName" is a value in this object, not a key.
    const response = await createPOST(makeUploadRequest({ "Some Column": "phone" }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe("IMPORT_INVALID_MAPPING");
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("accepts a mapping where a column was mapped to firstName", async () => {
    const response = await createPOST(makeUploadRequest({ "First Name": "firstName", "Last Name": "lastName" }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(createImportBatch).toHaveBeenCalled();
    expect(uploadImportSourceFile).toHaveBeenCalled();
    expect(analyzeBatch).toHaveBeenCalledWith("batch-1", "org-a");
  });

  it("accepts a mapping where a column was mapped to lastName only", async () => {
    const response = await createPOST(makeUploadRequest({ "Family Name": "lastName" }));
    expect(response.status).toBe(201);
  });

  it("returns the existing batch info instead of creating a new one when the file hash already matches an earlier import", async () => {
    findExistingBatchByHash.mockResolvedValueOnce({
      batchId: "batch-existing",
      status: "PARTIALLY_COMPLETED",
      totalRows: 800,
      importedCount: 460,
      uploadedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const response = await createPOST(makeUploadRequest({ "First Name": "firstName" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.matchedExistingBatch.batchId).toBe("batch-existing");
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("rejects a legacy .xls file with the exact conversion message BEFORE creating an ImportBatch, uploading to storage, or writing an audit event -- auth-ordering follow-up (.xls persistent-record fix)", async () => {
    // Unlike preview mode, the non-preview path used to have no
    // synchronous format check at all: a .xls upload would reach
    // prisma.importBatch.create() and uploadImportSourceFile() and only
    // fail later, asynchronously, inside analyzeBatch() (whose result
    // this route doesn't even wait for). This proves that gap is closed.
    const form = new FormData();
    form.set("file", new File(["not a real xls file"], "members.xls", { type: "application/vnd.ms-excel" }));
    form.set("mapping", JSON.stringify({ "First Name": "firstName" }));
    const response = await createPOST(new Request("https://portal.test/api/imports", { method: "POST", body: form }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe(LEGACY_XLS_MESSAGE);
    expect(createImportBatch).not.toHaveBeenCalled();
    expect(uploadImportSourceFile).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
    expect(analyzeBatch).not.toHaveBeenCalled();
  });

  it("SCOPE-BOUNDARY DOCUMENTATION (not asserted-safe, not fixed under this change): a spoofed extension on the non-preview path still creates an ImportBatch before the mismatch is caught -- unlike .xls above, this is deferred to analyzeBatch()'s own FORMAT_MISMATCH-to-FAILED transition, by the pre-existing resumable-import architecture (Import Program 2026-08), not something introduced or fixed by the auth-ordering/.xls follow-up", async () => {
    // Contrast with the .xls test above: that one is now rejected
    // synchronously (400, no batch) because the extension itself (".xls")
    // is unambiguous without reading any bytes. A SPOOFED extension (real
    // CSV content named "members.xlsx") can only be caught by actually
    // parsing the file -- which the non-preview path defers to
    // analyzeBatch(), called fire-and-forget after the batch already
    // exists. This is intentional: the resumable-import design wants a
    // trackable record even for a batch that turns out to be malformed,
    // so a user isn't left wondering whether their upload was received.
    // Recorded here as an explicit, deliberate scope boundary -- see the
    // final report's "deferred findings" section if full synchronous
    // parity with /api/import is ever wanted.
    const form = new FormData();
    form.set("file", new File(["First Name,Last Name\nJane,Doe\n"], "members.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    form.set("mapping", JSON.stringify({ "First Name": "firstName" }));
    const response = await createPOST(new Request("https://portal.test/api/imports", { method: "POST", body: form }));

    expect(response.status).toBe(201);
    expect(createImportBatch).toHaveBeenCalledTimes(1);
    expect(uploadImportSourceFile).toHaveBeenCalledTimes(1);
    // The actual FORMAT_MISMATCH rejection happens inside analyzeBatch(),
    // which IS invoked (fire-and-forget) -- its real implementation
    // (mocked here) is what transitions this batch to FAILED. See
    // imports-engine-analyze.test.ts for that behavior's own coverage.
    expect(analyzeBatch).toHaveBeenCalledTimes(1);
  });

  it("does not treat a renamed arbitrary file as a valid legacy workbook -- a .xls-named file with executable content is still rejected on the claimed extension alone, no batch created", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], "totally-not-a-workbook.xls", { type: "application/vnd.ms-excel" }));
    form.set("mapping", JSON.stringify({ "First Name": "firstName" }));
    const response = await createPOST(new Request("https://portal.test/api/imports", { method: "POST", body: form }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe(LEGACY_XLS_MESSAGE);
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("proceeds with a new analysis when forceNewAnalysis is set, even if a hash match exists", async () => {
    findExistingBatchByHash.mockResolvedValueOnce({
      batchId: "batch-existing",
      status: "COMPLETED",
      totalRows: 5,
      importedCount: 5,
      uploadedAt: new Date(),
    });

    const form = new FormData();
    form.set("file", new File(["First Name,Last Name\nJane,Doe\n"], "members.csv", { type: "text/csv" }));
    form.set("mapping", JSON.stringify({ "First Name": "firstName" }));
    form.set("forceNewAnalysis", "1");

    const response = await createPOST(new Request("https://portal.test/api/imports", { method: "POST", body: form }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.batchId).toBe("batch-1");
    expect(createImportBatch).toHaveBeenCalled();
  });
});

describe("POST /api/imports — PR C kind-based RBAC dual-gate", () => {
  it("creates a PTA_HOUSEHOLDS batch when the org is PTA-vertical and the caller holds pta:households:manage", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce(permissionContext(["imports:create", "pta:households:manage"]));
    const response = await createPOST(
      makeUploadRequest(
        { "Household Name": "householdName", "School Year": "schoolYear", "Contact Name": "contactName" },
        "PTA_HOUSEHOLDS",
        "Household Name,School Year,Contact Name\nThe Doe Family,2026-2027,Jane Doe\n"
      )
    );
    expect(response.status).toBe(201);
    expect(requirePtaVertical).toHaveBeenCalledWith("org-a");
    expect(createImportBatch).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ importKind: "PTA_HOUSEHOLDS" }) }));
  });

  it("rejects a PTA_HOUSEHOLDS batch when the caller lacks pta:households:manage, even though imports:create is granted", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce(permissionContext(["imports:create"]));
    const response = await createPOST(
      makeUploadRequest({ "Household Name": "householdName", "School Year": "schoolYear", "Contact Name": "contactName" }, "PTA_HOUSEHOLDS")
    );
    expect(response.status).toBe(403);
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("rejects a PTA_HOUSEHOLDS batch when the organization is not actually PTA-vertical", async () => {
    const { PtaError } = await import("@/lib/labs/pta/errors");
    requirePtaVertical.mockRejectedValueOnce(new PtaError("PTA_ORGANIZATION_NOT_PTA_VERTICAL", "This organization is not a PTA/PTO organization."));
    vi.mocked(requirePermission).mockResolvedValueOnce(permissionContext(["imports:create", "pta:households:manage"]));
    const response = await createPOST(
      makeUploadRequest({ "Household Name": "householdName", "School Year": "schoolYear", "Contact Name": "contactName" }, "PTA_HOUSEHOLDS")
    );
    expect(response.status).not.toBe(201);
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("rejects a PTA_HOUSEHOLDS mapping missing a required field (Household Name/School Year/Contact Name)", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce(permissionContext(["imports:create", "pta:households:manage"]));
    const response = await createPOST(makeUploadRequest({ "Household Name": "householdName" }, "PTA_HOUSEHOLDS"));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.code).toBe("IMPORT_INVALID_MAPPING");
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("creates an HOA_PROPERTIES batch when the org has the properties capability and the caller holds both hoa:properties:write and hoa:residents:write", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce(permissionContext(["imports:create", "hoa:properties:write", "hoa:residents:write"]));
    const response = await createPOST(
      makeUploadRequest({ "Street Address": "addressLine1" }, "HOA_PROPERTIES", "Street Address\n123 Main St\n")
    );
    expect(response.status).toBe(201);
    expect(requireHoaCapability).toHaveBeenCalledWith("org-a");
    expect(createImportBatch).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ importKind: "HOA_PROPERTIES" }) }));
  });

  it("rejects an HOA_PROPERTIES batch when the caller is missing hoa:residents:write (only holds hoa:properties:write)", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce(permissionContext(["imports:create", "hoa:properties:write"]));
    const response = await createPOST(makeUploadRequest({ "Street Address": "addressLine1" }, "HOA_PROPERTIES"));
    expect(response.status).toBe(403);
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("rejects an HOA_PROPERTIES mapping missing the required street address field", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce(permissionContext(["imports:create", "hoa:properties:write", "hoa:residents:write"]));
    const response = await createPOST(makeUploadRequest({ "Unit": "unitLabel" }, "HOA_PROPERTIES"));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.code).toBe("IMPORT_INVALID_MAPPING");
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized kind value", async () => {
    const response = await createPOST(makeUploadRequest({ "First Name": "firstName" }, "NOT_A_REAL_KIND"));
    expect(response.status).toBe(400);
    expect(createImportBatch).not.toHaveBeenCalled();
  });
});

/**
 * Security Patch A -- the preview mode added to this route so the upload
 * form's column-mapping step never needs to parse a spreadsheet in the
 * browser. Runs the real hardened parser (not mocked) and, critically,
 * never creates a batch or writes to storage -- these tests exist mainly
 * to prove that.
 */
describe("POST /api/imports -- preview mode (Security Patch A)", () => {
  function makePreviewRequest(csvContent: string, filename = "members.csv"): Request {
    const form = new FormData();
    form.set("file", new File([csvContent], filename, { type: "text/csv" }));
    form.set("kind", "COMMUNITY_MEMBERS");
    form.set("preview", "1");
    return new Request("https://portal.test/api/imports", { method: "POST", body: form });
  }

  it("returns real headers and a preview without creating a batch or writing to storage", async () => {
    const response = await createPOST(makePreviewRequest("First Name,Last Name\nJane,Doe\nJohn,Smith\n"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.headers).toEqual(["First Name", "Last Name"]);
    expect(payload.data.preview).toEqual([{ "First Name": "Jane", "Last Name": "Doe" }, { "First Name": "John", "Last Name": "Smith" }]);
    expect(payload.data.totalRows).toBe(2);
    expect(createImportBatch).not.toHaveBeenCalled();
    expect(uploadImportSourceFile).not.toHaveBeenCalled();
    expect(analyzeBatch).not.toHaveBeenCalled();
  });

  it("rejects a __proto__ header in preview mode, with no batch created", async () => {
    const response = await createPOST(makePreviewRequest("__proto__,Last Name\nx,Doe\n"));
    expect(response.status).toBe(400);
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("rejects a spoofed extension in preview mode, with no batch created", async () => {
    const response = await createPOST(makePreviewRequest("First Name,Last Name\nJane,Doe\n", "members.xlsx"));
    expect(response.status).toBe(400);
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("rejects a legacy .xls file in preview mode with the exact conversion message, no batch created", async () => {
    const response = await createPOST(makePreviewRequest("not a real xls file", "members.xls"));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error).toBe(LEGACY_XLS_MESSAGE);
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("still requires imports:create for a preview request", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce(permissionContext([]));
    const response = await createPOST(makePreviewRequest("First Name\nJane\n"));
    expect(response.status).not.toBe(200);
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After and creates no batch when this organization already has a parse in flight (worker-isolation follow-up)", async () => {
    resetParseAdmissionStateForTests();
    const holdOpen = new Promise<void>(() => {});
    withParseAdmission("org-a", () => holdOpen).catch(() => {});
    await new Promise((r) => setTimeout(r, 10));

    const response = await createPOST(makePreviewRequest("First Name\nJane\n"));
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    expect(payload.ok).toBe(false);
    expect(createImportBatch).not.toHaveBeenCalled();

    resetParseAdmissionStateForTests();
  });
});

/**
 * Auth-ordering follow-up -- this route's auth/rate-limit/content-length
 * ordering was already correct before this change (see the summary in
 * route.ts); only the content-type check and safe malformed-multipart
 * handling were added. These tests prove the new behavior and, via the
 * formData spy, prove no request that should be rejected pre-parse ever
 * reaches request.formData().
 */
describe("POST /api/imports -- auth-before-parse ordering (auth-ordering follow-up)", () => {
  let formDataSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    formDataSpy = vi.spyOn(Request.prototype, "formData");
  });

  afterEach(() => {
    formDataSpy.mockRestore();
  });

  it("returns 401 for an unauthenticated request and never calls request.formData()", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new UnauthenticatedError());
    const response = await createPOST(makeUploadRequest({ "First Name": "firstName" }));
    expect(response.status).toBe(401);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("returns 429 for a rate-limited request and never calls request.formData()", async () => {
    vi.mocked(requireRateLimit).mockResolvedValueOnce(
      Response.json({ ok: false, error: "Too many requests" }, { status: 429, headers: { "Retry-After": "5" } })
    );
    const response = await createPOST(makeUploadRequest({ "First Name": "firstName" }));
    expect(response.status).toBe(429);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("checks the declared Content-Length before parsing and rejects an oversized request with 413 without calling request.formData() (malformed-request-behavior follow-up)", async () => {
    const response = await createPOST(
      new Request("https://portal.test/api/imports", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(51 * 1024 * 1024) },
        body: "irrelevant -- rejected on the declared length before this body is ever read",
      })
    );
    const payload = await response.json();
    expect(response.status).toBe(413);
    expect(payload.error).toBeTruthy();
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("checks Content-Type before parsing and rejects a non-multipart request with 415 without calling request.formData()", async () => {
    const response = await createPOST(
      new Request("https://portal.test/api/imports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: "nope" }) })
    );
    const payload = await response.json();
    expect(response.status).toBe(415);
    expect(payload.error).toBeTruthy();
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("returns a safe 400 (not 500) for a malformed multipart body with a claimed multipart content type", async () => {
    const response = await createPOST(
      new Request("https://portal.test/api/imports", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body: "not valid multipart data" })
    );
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error).toBeTruthy();
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("returns a safe 400 for a well-formed multipart request with no file field", async () => {
    const form = new FormData();
    form.set("mapping", "{}");
    const response = await createPOST(new Request("https://portal.test/api/imports", { method: "POST", body: form }));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error).toBeTruthy();
    expect(createImportBatch).not.toHaveBeenCalled();
  });
});
