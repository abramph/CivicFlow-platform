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
const findFirstPtaStudent = vi.fn();
const findFirstPropertyResident = vi.fn();
const findUniqueUser = vi.fn();

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
    ptaStudent: {
      findFirst: (...args: unknown[]) => findFirstPtaStudent(...args),
    },
    propertyResident: {
      findFirst: (...args: unknown[]) => findFirstPropertyResident(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => findUniqueUser(...args),
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

// The real matching-tier logic (email/phone/name+corroborating, and PTA/HOA's
// deterministic key matching) has its own dedicated test file
// (duplicate-matching.test.ts) — analyzeBatch's own tests only need to prove
// it calls the right matcher per kind and persists whatever it returns.
const matchCommunityMemberRow = vi.fn();
const matchPtaHouseholdRow = vi.fn();
const matchHoaPropertyRow = vi.fn();
vi.mock("../duplicate-matching", () => ({
  matchCommunityMemberRow: (...args: unknown[]) => matchCommunityMemberRow(...args),
  matchPtaHouseholdRow: (...args: unknown[]) => matchPtaHouseholdRow(...args),
  matchHoaPropertyRow: (...args: unknown[]) => matchHoaPropertyRow(...args),
}));

// Same rationale — createPtaHousehold/addPtaHouseholdAdult/addPtaStudent and
// createProperty/assignPropertyResident are the shared service layer, tested
// on their own; executeBatch()'s PTA/HOA tests only need to prove it calls
// the right ones with the right arguments per decision.
const createPtaHousehold = vi.fn();
const addPtaHouseholdAdult = vi.fn();
const addPtaStudent = vi.fn();
vi.mock("@/lib/labs/pta/households", () => ({
  createPtaHousehold: (...args: unknown[]) => createPtaHousehold(...args),
  addPtaHouseholdAdult: (...args: unknown[]) => addPtaHouseholdAdult(...args),
  addPtaStudent: (...args: unknown[]) => addPtaStudent(...args),
}));

const createProperty = vi.fn();
const assignPropertyResident = vi.fn();
vi.mock("@/lib/hoa/properties", () => ({
  createProperty: (...args: unknown[]) => createProperty(...args),
  assignPropertyResident: (...args: unknown[]) => assignPropertyResident(...args),
}));

const checkMemberLimit = vi.fn();
vi.mock("@/lib/plan-gate", () => ({
  checkMemberLimit: (...args: unknown[]) => checkMemberLimit(...args),
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
    uploadedByUserId: "user-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  FIXTURE_ROWS = [];
  transitionImportBatch.mockResolvedValue({});
  updateManyImportBatch.mockResolvedValue({ count: 1 });
  findUniqueUser.mockResolvedValue({ email: "staff@example.com" });
  findFirstPtaStudent.mockResolvedValue(null);
  findFirstPropertyResident.mockResolvedValue(null);
});

describe("analyzeBatch", () => {
  it("classifies a row with no match as NEW", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    getImportSourceFile.mockResolvedValueOnce(Buffer.from(""));
    FIXTURE_ROWS = [{ "First Name": "Jane", "Last Name": "Doe", Email: "jane@example.com" }];
    matchCommunityMemberRow.mockResolvedValueOnce({ status: "NEW", matchedRecordId: null, matchConfidence: null });

    const { analyzeBatch } = await import("../engine");
    await analyzeBatch("batch-1", "org-a");

    expect(createImportRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "NEW", rowNumber: 2 }) })
    );
    expect(transitionImportBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "READY_FOR_REVIEW",
        extraData: expect.objectContaining({ newCount: 1, updateCount: 0, duplicateCount: 0, invalidCount: 0 }),
      })
    );
  });

  it("persists whatever matchCommunityMemberRow() classifies a row as, counting UPDATE_AVAILABLE separately from duplicate-tier statuses", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    getImportSourceFile.mockResolvedValueOnce(Buffer.from(""));
    FIXTURE_ROWS = [{ "First Name": "Jane", "Last Name": "Doe", Email: "jane@example.com" }];
    matchCommunityMemberRow.mockResolvedValueOnce({ status: "UPDATE_AVAILABLE", matchedRecordId: "member-existing", matchConfidence: 100 });

    const { analyzeBatch } = await import("../engine");
    await analyzeBatch("batch-1", "org-a");

    expect(createImportRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "UPDATE_AVAILABLE", matchedRecordId: "member-existing", matchConfidence: 100 }) })
    );
    expect(transitionImportBatch).toHaveBeenCalledWith(
      expect.objectContaining({ extraData: expect.objectContaining({ updateCount: 1, duplicateCount: 0 }) })
    );
  });

  it("counts EXACT_DUPLICATE and POSSIBLE_DUPLICATE rows into duplicateCount, not updateCount", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    getImportSourceFile.mockResolvedValueOnce(Buffer.from(""));
    FIXTURE_ROWS = [
      { "First Name": "Jane", "Last Name": "Doe", Email: "jane@example.com" },
      { "First Name": "Sam", "Last Name": "Rivera", Email: "" },
    ];
    matchCommunityMemberRow
      .mockResolvedValueOnce({ status: "EXACT_DUPLICATE", matchedRecordId: "member-1", matchConfidence: 100 })
      .mockResolvedValueOnce({ status: "POSSIBLE_DUPLICATE", matchedRecordId: "member-2", matchConfidence: 50 });

    const { analyzeBatch } = await import("../engine");
    await analyzeBatch("batch-1", "org-a");

    expect(transitionImportBatch).toHaveBeenCalledWith(
      expect.objectContaining({ extraData: expect.objectContaining({ newCount: 0, updateCount: 0, duplicateCount: 2 }) })
    );
  });

  it("classifies a row with no name at all as INVALID without ever calling the matcher", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    getImportSourceFile.mockResolvedValueOnce(Buffer.from(""));
    FIXTURE_ROWS = [{ "First Name": "", "Last Name": "", Email: "" }];

    const { analyzeBatch } = await import("../engine");
    await analyzeBatch("batch-1", "org-a");

    expect(createImportRow).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "INVALID" }) })
    );
    expect(matchCommunityMemberRow).not.toHaveBeenCalled();
  });

  it("treats a duplicate row insert (P2002, e.g. a retried analysis) as already-processed, not an error", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    getImportSourceFile.mockResolvedValueOnce(Buffer.from(""));
    FIXTURE_ROWS = [{ "First Name": "Jane", "Last Name": "Doe", Email: "jane@example.com" }];
    matchCommunityMemberRow.mockResolvedValueOnce({ status: "NEW", matchedRecordId: null, matchConfidence: null });
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
      data: { status: "IMPORTED", importedRecordId: "member-new", errorMessage: null, processedAt: expect.any(Date) },
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

  it("SECURITY/DATA-INTEGRITY REGRESSION: never overwrites an existing field with a blank incoming value", async () => {
    // Previously memberUpdateData() built a fixed object unconditionally --
    // an UPDATE_EXISTING row with a blank phone/address/etc. column would
    // silently null out the existing member's real data. Now a field is
    // only included in the update payload when the incoming value is
    // actually present.
    findFirstImportBatch.mockResolvedValueOnce(makeBatch());
    findManyImportRow.mockResolvedValueOnce([
      {
        id: "row-1",
        decision: "UPDATE_EXISTING",
        matchedRecordId: "member-existing",
        normalizedData: {
          firstName: "Jane",
          lastName: "Doe",
          email: "jane@example.com",
          phone: null,
          addressLine1: null,
          city: null,
          state: null,
          zipCode: null,
          joinDate: null,
        },
      },
    ]);
    updateOrgMember.mockResolvedValueOnce({ id: "member-existing" });
    countImportRow.mockResolvedValueOnce(0);

    const { executeBatch } = await import("../engine");
    await executeBatch("batch-1", "org-a");

    const call = updateOrgMember.mock.calls[0][0];
    expect(call.data).toEqual({ firstName: "Jane", lastName: "Doe" });
    expect(call.data).not.toHaveProperty("phone");
    expect(call.data).not.toHaveProperty("addressLine1");
    expect(call.data).not.toHaveProperty("joinDate");
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

// ─── PR C: PTA households ───────────────────────────────────────────────────

describe("analyzeBatch — PTA households (PR C)", () => {
  it("dispatches to matchPtaHouseholdRow (not matchCommunityMemberRow) and classifies a NEW household", async () => {
    findFirstImportBatch.mockResolvedValueOnce(
      makeBatch({ importKind: "PTA_HOUSEHOLDS", columnMapping: { "Household Name": "householdName", "School Year": "schoolYear", "Contact Name": "contactName" } })
    );
    getImportSourceFile.mockResolvedValueOnce(Buffer.from(""));
    FIXTURE_ROWS = [{ "Household Name": "The Doe Family", "School Year": "2026-2027", "Contact Name": "Jane Doe" }];
    matchPtaHouseholdRow.mockResolvedValueOnce({ status: "NEW", matchedRecordId: null, matchConfidence: null });

    const { analyzeBatch } = await import("../engine");
    await analyzeBatch("batch-1", "org-a");

    expect(matchPtaHouseholdRow).toHaveBeenCalled();
    expect(matchCommunityMemberRow).not.toHaveBeenCalled();
    expect(createImportRow).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "NEW" }) }));
  });

  it("classifies a household row missing a required field as INVALID without ever calling the matcher", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch({ importKind: "PTA_HOUSEHOLDS", columnMapping: { "Household Name": "householdName" } }));
    getImportSourceFile.mockResolvedValueOnce(Buffer.from(""));
    FIXTURE_ROWS = [{ "Household Name": "The Doe Family" }]; // missing schoolYear/contactName

    const { analyzeBatch } = await import("../engine");
    await analyzeBatch("batch-1", "org-a");

    expect(createImportRow).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "INVALID" }) }));
    expect(matchPtaHouseholdRow).not.toHaveBeenCalled();
  });
});

describe("executeBatch — PTA households (PR C)", () => {
  const householdRow = (overrides: Record<string, unknown> = {}) => ({
    id: "row-1",
    decision: "IMPORT_NEW",
    matchedRecordId: null,
    normalizedData: {
      householdName: "The Doe Family",
      schoolYear: "2026-2027",
      contactName: "Jane Doe",
      contactEmail: "jane@example.com",
      contactPhone: null,
      studentNames: ["Alex Doe"],
      notes: null,
    },
    ...overrides,
  });

  it("creates a new household, adds the primary contact adult, and adds students for an IMPORT_NEW row", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch({ importKind: "PTA_HOUSEHOLDS" }));
    findManyImportRow.mockResolvedValueOnce([householdRow()]);
    createPtaHousehold.mockResolvedValueOnce({ id: "household-new" });
    countImportRow.mockResolvedValueOnce(0);

    const { executeBatch } = await import("../engine");
    await executeBatch("batch-1", "org-a");

    expect(createPtaHousehold).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "The Doe Family", schoolYear: "2026-2027", actorUserId: "user-1", actorEmail: "staff@example.com" })
    );
    expect(addPtaHouseholdAdult).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: "household-new", name: "Jane Doe", makePrimaryContact: true })
    );
    expect(addPtaStudent).toHaveBeenCalledWith(expect.objectContaining({ householdId: "household-new", displayName: "Alex Doe" }));
    expect(updateImportRow).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: { status: "IMPORTED", importedRecordId: "household-new", errorMessage: null, processedAt: expect.any(Date) },
    });
  });

  it("reuses the matched household id for UPDATE_EXISTING instead of recreating it", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch({ importKind: "PTA_HOUSEHOLDS" }));
    findManyImportRow.mockResolvedValueOnce([householdRow({ decision: "UPDATE_EXISTING", matchedRecordId: "household-existing" })]);
    countImportRow.mockResolvedValueOnce(0);

    const { executeBatch } = await import("../engine");
    await executeBatch("batch-1", "org-a");

    expect(createPtaHousehold).not.toHaveBeenCalled();
    expect(addPtaHouseholdAdult).toHaveBeenCalledWith(expect.objectContaining({ householdId: "household-existing" }));
  });

  it("skips a student name already recorded on the household (idempotent per name, same as importPtaHouseholds())", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch({ importKind: "PTA_HOUSEHOLDS" }));
    findManyImportRow.mockResolvedValueOnce([householdRow({ decision: "UPDATE_EXISTING", matchedRecordId: "household-existing" })]);
    findFirstPtaStudent.mockResolvedValueOnce({ id: "student-existing" });
    countImportRow.mockResolvedValueOnce(0);

    const { executeBatch } = await import("../engine");
    await executeBatch("batch-1", "org-a");

    expect(addPtaStudent).not.toHaveBeenCalled();
  });

  it("throws IMPORT_MISSING_ACTOR without ever claiming the batch when uploadedByUserId is missing", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch({ importKind: "PTA_HOUSEHOLDS", uploadedByUserId: null }));

    const { executeBatch } = await import("../engine");
    const { ImportError } = await import("../errors");
    await expect(executeBatch("batch-1", "org-a")).rejects.toBeInstanceOf(ImportError);
    expect(updateManyImportBatch).not.toHaveBeenCalled(); // claimBatchForProcessing never reached
  });
});

// ─── PR C: HOA properties ───────────────────────────────────────────────────

describe("analyzeBatch — HOA properties (PR C)", () => {
  it("dispatches to matchHoaPropertyRow and classifies a NEW property", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch({ importKind: "HOA_PROPERTIES", columnMapping: { "Street Address": "addressLine1" } }));
    getImportSourceFile.mockResolvedValueOnce(Buffer.from(""));
    FIXTURE_ROWS = [{ "Street Address": "123 Main St" }];
    matchHoaPropertyRow.mockResolvedValueOnce({ status: "NEW", matchedRecordId: null, matchConfidence: null });

    const { analyzeBatch } = await import("../engine");
    await analyzeBatch("batch-1", "org-a");

    expect(matchHoaPropertyRow).toHaveBeenCalled();
    expect(createImportRow).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "NEW" }) }));
  });

  it("classifies a property row missing the required street address as INVALID without calling the matcher", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch({ importKind: "HOA_PROPERTIES", columnMapping: { "Street Address": "addressLine1" } }));
    getImportSourceFile.mockResolvedValueOnce(Buffer.from(""));
    FIXTURE_ROWS = [{ "Street Address": "" }];

    const { analyzeBatch } = await import("../engine");
    await analyzeBatch("batch-1", "org-a");

    expect(createImportRow).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "INVALID" }) }));
    expect(matchHoaPropertyRow).not.toHaveBeenCalled();
  });
});

describe("executeBatch — HOA properties (PR C)", () => {
  const propertyRow = (overrides: Record<string, unknown> = {}) => ({
    id: "row-1",
    decision: "IMPORT_NEW",
    matchedRecordId: null,
    normalizedData: {
      addressLine1: "123 Main St",
      addressLine2: null,
      city: null,
      state: null,
      zipCode: null,
      unitLabel: null,
      buildingLabel: null,
      propertyType: null,
      ownerFirstName: "Sam",
      ownerLastName: "Owner",
      ownerEmail: "sam@example.com",
      ownerEmailError: null,
      relationshipType: null,
      notes: null,
    },
    ...overrides,
  });

  it("creates a new property and links a newly-created owner for an IMPORT_NEW row", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch({ importKind: "HOA_PROPERTIES" }));
    findManyImportRow.mockResolvedValueOnce([propertyRow()]);
    createProperty.mockResolvedValueOnce({ id: "property-new" });
    findFirstOrgMember.mockResolvedValueOnce(null); // no existing owner member by email
    checkMemberLimit.mockResolvedValueOnce({ allowed: true, current: 10, limit: 500 });
    createOrgMember.mockResolvedValueOnce({ id: "owner-new" });
    countImportRow.mockResolvedValueOnce(0);

    const { executeBatch } = await import("../engine");
    await executeBatch("batch-1", "org-a");

    expect(createProperty).toHaveBeenCalledWith(expect.objectContaining({ addressLine1: "123 Main St", actorUserId: "user-1" }));
    expect(createOrgMember).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ firstName: "Sam", lastName: "Owner" }) }));
    expect(assignPropertyResident).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: "property-new", orgMemberId: "owner-new", isPrimaryContact: true })
    );
    expect(updateImportRow).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: { status: "IMPORTED", importedRecordId: "property-new", errorMessage: null, processedAt: expect.any(Date) },
    });
  });

  it("reuses an existing OrgMember matched by owner email instead of creating a duplicate", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch({ importKind: "HOA_PROPERTIES" }));
    findManyImportRow.mockResolvedValueOnce([propertyRow({ decision: "UPDATE_EXISTING", matchedRecordId: "property-existing" })]);
    findFirstOrgMember.mockResolvedValueOnce({ id: "owner-existing" });
    countImportRow.mockResolvedValueOnce(0);

    const { executeBatch } = await import("../engine");
    await executeBatch("batch-1", "org-a");

    expect(createProperty).not.toHaveBeenCalled();
    expect(createOrgMember).not.toHaveBeenCalled();
    expect(checkMemberLimit).not.toHaveBeenCalled();
    expect(assignPropertyResident).toHaveBeenCalledWith(expect.objectContaining({ propertyId: "property-existing", orgMemberId: "owner-existing" }));
  });

  it("SECURITY/DATA-INTEGRITY: property row still succeeds (IMPORTED) when the member limit is hit — owner link skipped with a note, never BLOCKED_PLAN_LIMIT or FAILED", async () => {
    // Mirrors importHoaProperties()'s existing graceful-degradation behavior
    // exactly (vertical-import.ts) — this is a deliberate, preserved-from-
    // today behavior, not a regression, per the PR C capacity decision.
    findFirstImportBatch.mockResolvedValueOnce(makeBatch({ importKind: "HOA_PROPERTIES" }));
    findManyImportRow.mockResolvedValueOnce([propertyRow()]);
    createProperty.mockResolvedValueOnce({ id: "property-new" });
    findFirstOrgMember.mockResolvedValueOnce(null);
    checkMemberLimit.mockResolvedValueOnce({ allowed: false, current: 500, limit: 500 });
    countImportRow.mockResolvedValueOnce(0);

    const { executeBatch } = await import("../engine");
    await executeBatch("batch-1", "org-a");

    expect(createOrgMember).not.toHaveBeenCalled();
    expect(assignPropertyResident).not.toHaveBeenCalled();
    expect(updateImportRow).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: {
        status: "IMPORTED",
        importedRecordId: "property-new",
        errorMessage: expect.stringContaining("member limit reached"),
        processedAt: expect.any(Date),
      },
    });
  });

  it("creates the property with no owner-linking attempt at all when no owner fields are mapped", async () => {
    findFirstImportBatch.mockResolvedValueOnce(makeBatch({ importKind: "HOA_PROPERTIES" }));
    findManyImportRow.mockResolvedValueOnce([propertyRow({ normalizedData: { ...propertyRow().normalizedData, ownerFirstName: null, ownerLastName: null } })]);
    createProperty.mockResolvedValueOnce({ id: "property-new" });
    countImportRow.mockResolvedValueOnce(0);

    const { executeBatch } = await import("../engine");
    await executeBatch("batch-1", "org-a");

    expect(findFirstOrgMember).not.toHaveBeenCalled();
    expect(checkMemberLimit).not.toHaveBeenCalled();
    expect(assignPropertyResident).not.toHaveBeenCalled();
  });
});
