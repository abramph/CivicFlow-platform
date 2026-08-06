import { beforeEach, describe, expect, it, vi } from "vitest";

const { FakeP2002Error } = vi.hoisted(() => {
  class FakeP2002Error extends Error {
    code = "P2002";
  }
  return { FakeP2002Error };
});

vi.mock("@prisma/client", () => ({
  Prisma: { PrismaClientKnownRequestError: FakeP2002Error },
}));

const findFirstImportBatch = vi.fn();
const updateManyImportBatch = vi.fn();
const findManyImportBatch = vi.fn();
const updateImportBatch = vi.fn();
const createImportRow = vi.fn();
const findManyImportRow = vi.fn();
const updateManyImportRow = vi.fn();
const updateImportRow = vi.fn();
const countImportRow = vi.fn();
const findFirstOrgMember = vi.fn();
const createOrgMember = vi.fn();
const updateOrgMember = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    importBatch: {
      findFirst: (...args: unknown[]) => findFirstImportBatch(...args),
      updateMany: (...args: unknown[]) => updateManyImportBatch(...args),
      findMany: (...args: unknown[]) => findManyImportBatch(...args),
      update: (...args: unknown[]) => updateImportBatch(...args),
    },
    importRow: {
      create: (...args: unknown[]) => createImportRow(...args),
      findMany: (...args: unknown[]) => findManyImportRow(...args),
      updateMany: (...args: unknown[]) => updateManyImportRow(...args),
      update: (...args: unknown[]) => updateImportRow(...args),
      count: (...args: unknown[]) => countImportRow(...args),
    },
    orgMember: {
      findFirst: (...args: unknown[]) => findFirstOrgMember(...args),
      create: (...args: unknown[]) => createOrgMember(...args),
      update: (...args: unknown[]) => updateOrgMember(...args),
    },
  },
}));

const transitionImportBatch = vi.fn().mockResolvedValue({});
vi.mock("../batch-state-machine", () => ({
  transitionImportBatch: (...args: unknown[]) => transitionImportBatch(...args),
}));

const getImportSourceFile = vi.fn();
vi.mock("../storage", () => ({
  getImportSourceFile: (...args: unknown[]) => getImportSourceFile(...args),
}));

const checkImportCapacity = vi.fn();
const buildPlanLimitSnapshot = vi.fn();
const importKindConsumesCapacity = vi.fn((kind: string) => kind === "COMMUNITY_MEMBERS");
vi.mock("../capacity", () => ({
  checkImportCapacity: (...args: unknown[]) => checkImportCapacity(...args),
  buildPlanLimitSnapshot: (...args: unknown[]) => buildPlanLimitSnapshot(...args),
  importKindConsumesCapacity: (...args: [string]) => importKindConsumesCapacity(...args),
}));

vi.mock("xlsx", () => ({
  read: vi.fn(() => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: {} } })),
  utils: {
    sheet_to_json: vi.fn(() => FIXTURE_ROWS),
  },
}));

let FIXTURE_ROWS: Record<string, string>[] = [];

function makeBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "batch-1",
    organizationId: "org-a",
    importKind: "COMMUNITY_MEMBERS",
    storageObjectKey: "organizations/org-a/imports/batch-1/source/file.csv",
    columnMapping: { "First Name": "firstName", "Last Name": "lastName", Email: "email" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  FIXTURE_ROWS = [];
  transitionImportBatch.mockResolvedValue({});
  updateManyImportBatch.mockResolvedValue({ count: 1 });
});

describe("analyzeBatch", () => {
  it("classifies a row with no existing email match as NEW", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    getImportSourceFile.mockResolvedValueOnce(Buffer.from(""));
    FIXTURE_ROWS = [{ "First Name": "Jane", "Last Name": "Doe", Email: "jane@example.com" }];
    findFirstOrgMember.mockResolvedValueOnce(null);

    const { analyzeBatch } = await import("../engine");
    await analyzeBatch("batch-1", "org-a");

    expect(createImportRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "NEW", rowNumber: 2 }) })
    );
    expect(transitionImportBatch).toHaveBeenCalledWith(
      expect.objectContaining({ to: "READY_FOR_REVIEW", extraData: expect.objectContaining({ newCount: 1, updateCount: 0, invalidCount: 0 }) })
    );
  });

  it("classifies an exact email match as UPDATE_AVAILABLE, matching the existing member's id", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    getImportSourceFile.mockResolvedValueOnce(Buffer.from(""));
    FIXTURE_ROWS = [{ "First Name": "Jane", "Last Name": "Doe", Email: "jane@example.com" }];
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-existing" });

    const { analyzeBatch } = await import("../engine");
    await analyzeBatch("batch-1", "org-a");

    expect(createImportRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "UPDATE_AVAILABLE", matchedRecordId: "member-existing" }) })
    );
  });

  it("classifies a row with no name at all as INVALID", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    getImportSourceFile.mockResolvedValueOnce(Buffer.from(""));
    FIXTURE_ROWS = [{ "First Name": "", "Last Name": "", Email: "" }];

    const { analyzeBatch } = await import("../engine");
    await analyzeBatch("batch-1", "org-a");

    expect(createImportRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "INVALID" }) })
    );
    expect(findFirstOrgMember).not.toHaveBeenCalled();
  });

  it("treats a duplicate row insert (P2002, e.g. a retried analysis) as already-processed, not an error", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    getImportSourceFile.mockResolvedValueOnce(Buffer.from(""));
    FIXTURE_ROWS = [{ "First Name": "Jane", "Last Name": "Doe", Email: "jane@example.com" }];
    findFirstOrgMember.mockResolvedValueOnce(null);
    createImportRow.mockRejectedValueOnce(new FakeP2002Error("duplicate"));

    const { analyzeBatch } = await import("../engine");
    await expect(analyzeBatch("batch-1", "org-a")).resolves.not.toThrow();
    expect(transitionImportBatch).toHaveBeenCalledWith(expect.objectContaining({ to: "READY_FOR_REVIEW" }));
  });

  it("does nothing when the batch claim is lost (already claimed by another invocation)", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    updateManyImportBatch.mockResolvedValueOnce({ count: 0 });

    const { analyzeBatch } = await import("../engine");
    await analyzeBatch("batch-1", "org-a");

    expect(getImportSourceFile).not.toHaveBeenCalled();
    expect(transitionImportBatch).not.toHaveBeenCalled();
  });
});

describe("applyDefaultDecisions", () => {
  it("applies the spec's safe defaults per status", async () => {
    const { applyDefaultDecisions } = await import("../engine");
    await applyDefaultDecisions("batch-1");

    expect(updateManyImportRow).toHaveBeenCalledWith({
      where: { batchId: "batch-1", status: "NEW", decision: null },
      data: { decision: "IMPORT_NEW" },
    });
    expect(updateManyImportRow).toHaveBeenCalledWith({
      where: { batchId: "batch-1", status: "EXACT_DUPLICATE", decision: null },
      data: { decision: "SKIP" },
    });
    expect(updateManyImportRow).toHaveBeenCalledWith({
      where: { batchId: "batch-1", status: { in: ["POSSIBLE_DUPLICATE", "UPDATE_AVAILABLE"] }, decision: null },
      data: { decision: "REVIEW_REQUIRED" },
    });
  });
});

describe("executeBatch", () => {
  it("creates a new OrgMember for an IMPORT_NEW row and marks it IMPORTED", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    findManyImportRow.mockResolvedValueOnce([
      { id: "row-1", decision: "IMPORT_NEW", normalizedData: { firstName: "Jane", lastName: "Doe", email: "jane@example.com" } },
    ]);
    checkImportCapacity.mockResolvedValueOnce({ allowed: true, used: 10, limit: 500, remainingForThisBatch: 490 });
    createOrgMember.mockResolvedValueOnce({ id: "member-new" });
    countImportRow.mockResolvedValueOnce(0);

    const { executeBatch } = await import("../engine");
    await executeBatch("batch-1", "org-a");

    expect(createOrgMember).toHaveBeenCalled();
    expect(updateImportRow).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: { status: "IMPORTED", importedRecordId: "member-new", processedAt: expect.any(Date) },
    });
    expect(transitionImportBatch).toHaveBeenCalledWith(expect.objectContaining({ to: "COMPLETED" }));
  });

  it("updates the matched OrgMember for an UPDATE_EXISTING row without consuming capacity", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    findManyImportRow.mockResolvedValueOnce([
      {
        id: "row-1",
        decision: "UPDATE_EXISTING",
        matchedRecordId: "member-existing",
        normalizedData: { firstName: "Jane", lastName: "Doe", email: "jane@example.com" },
      },
    ]);
    updateOrgMember.mockResolvedValueOnce({ id: "member-existing" });
    countImportRow.mockResolvedValueOnce(0);

    const { executeBatch } = await import("../engine");
    await executeBatch("batch-1", "org-a");

    expect(checkImportCapacity).not.toHaveBeenCalled();
    expect(updateOrgMember).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "member-existing" } }));
  });

  it("pauses at PAUSED_PLAN_LIMIT the moment capacity is exhausted, blocking remaining eligible rows", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    findManyImportRow.mockResolvedValueOnce([
      { id: "row-1", decision: "IMPORT_NEW", normalizedData: { firstName: "A", lastName: "One", email: null } },
      { id: "row-2", decision: "IMPORT_NEW", normalizedData: { firstName: "B", lastName: "Two", email: null } },
    ]);
    checkImportCapacity.mockResolvedValueOnce({ allowed: false, used: 500, limit: 500, remainingForThisBatch: 0 });
    updateManyImportRow.mockResolvedValueOnce({ count: 0 }); // the bulk SKIP resolution at the top of executeBatch
    updateManyImportRow.mockResolvedValueOnce({ count: 2 }); // the BLOCKED_PLAN_LIMIT bulk update
    buildPlanLimitSnapshot.mockResolvedValueOnce({ allowed: 500, used: 500, pendingAfterUpgrade: 2 });

    const { executeBatch } = await import("../engine");
    await executeBatch("batch-1", "org-a");

    expect(createOrgMember).not.toHaveBeenCalled();
    expect(updateManyImportRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "BLOCKED_PLAN_LIMIT" } })
    );
    expect(transitionImportBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "PAUSED_PLAN_LIMIT",
        extraData: expect.objectContaining({ blockedPlanLimitCount: { increment: 2 } }),
      })
    );
  });

  it("resolves SKIP decisions in bulk without ever checking capacity", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    findManyImportRow.mockResolvedValueOnce([]);
    countImportRow.mockResolvedValueOnce(0);

    const { executeBatch } = await import("../engine");
    await executeBatch("batch-1", "org-a");

    expect(updateManyImportRow).toHaveBeenCalledWith({
      where: { batchId: "batch-1", decision: "SKIP", status: { notIn: ["IMPORTED", "SKIPPED", "FAILED"] } },
      data: { status: "SKIPPED", processedAt: expect.any(Date) },
    });
    expect(checkImportCapacity).not.toHaveBeenCalled();
  });

  it("does nothing when the batch claim is lost", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    updateManyImportBatch.mockResolvedValueOnce({ count: 0 });

    const { executeBatch } = await import("../engine");
    await executeBatch("batch-1", "org-a");

    expect(findManyImportRow).not.toHaveBeenCalled();
  });
});

describe("resumeBatch", () => {
  it("throws IMPORT_PLAN_LIMIT_REACHED and never transitions when capacity is still exhausted", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch({ status: "PAUSED_PLAN_LIMIT" }));
    checkImportCapacity.mockResolvedValueOnce({ allowed: false, used: 500, limit: 500, remainingForThisBatch: 0 });

    const { resumeBatch } = await import("../engine");
    const { ImportError } = await import("../errors");
    await expect(resumeBatch("batch-1", "org-a", "user-1")).rejects.toBeInstanceOf(ImportError);
    expect(transitionImportBatch).not.toHaveBeenCalled();
  });

  it("throws IMPORT_BATCH_NOT_RESUMABLE when the batch isn't PAUSED_PLAN_LIMIT", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch({ status: "COMPLETED" }));

    const { resumeBatch } = await import("../engine");
    const { ImportError } = await import("../errors");
    await expect(resumeBatch("batch-1", "org-a", "user-1")).rejects.toBeInstanceOf(ImportError);
    expect(checkImportCapacity).not.toHaveBeenCalled();
  });

  it("rechecks capacity fresh rather than trusting the stored snapshot, and transitions to IMPORTING when there's room", async () => {
    findFirstImportBatch
      .mockResolvedValueOnce(makeBatch({ status: "PAUSED_PLAN_LIMIT" }))
      .mockResolvedValueOnce(makeBatch({ status: "IMPORTING" }));
    checkImportCapacity.mockResolvedValueOnce({ allowed: true, used: 400, limit: 1000, remainingForThisBatch: 600 });
    updateManyImportBatch.mockResolvedValueOnce({ count: 1 });
    findManyImportRow.mockResolvedValueOnce([]);
    countImportRow.mockResolvedValueOnce(0);

    const { resumeBatch } = await import("../engine");
    await resumeBatch("batch-1", "org-a", "user-1");

    expect(transitionImportBatch).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: "batch-1", to: "IMPORTING", actorUserId: "user-1" })
    );
  });
});
