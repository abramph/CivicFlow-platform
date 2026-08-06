import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "officer-1", userEmail: "officer@example.com" },
      organizationId: "org-a",
      role: "ORG_ADMIN",
      can: (permission: string) => ["imports:create", "members:write"].includes(permission),
    }),
  };
});

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

import { POST as createPOST } from "@/app/api/imports/route";

function makeUploadRequest(mapping: Record<string, string>, csvContent = "First Name,Last Name\nJane,Doe\n") {
  const form = new FormData();
  form.set("file", new File([csvContent], "members.csv", { type: "text/csv" }));
  form.set("mapping", JSON.stringify(mapping));
  return new Request("https://portal.test/api/imports", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  findExistingBatchByHash.mockResolvedValue(null);
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
