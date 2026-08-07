import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { requirePermission } from "@/lib/auth-guards";
import { POST as createPOST } from "@/app/api/imports/route";

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
