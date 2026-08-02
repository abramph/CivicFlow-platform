import { beforeEach, describe, expect, it, vi } from "vitest";

const ptaHouseholdFindFirst = vi.fn();
const propertyFindFirst = vi.fn();
const orgMemberFindFirst = vi.fn();
const orgMemberCreate = vi.fn();
const propertyResidentFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHousehold: { findFirst: (...a: unknown[]) => ptaHouseholdFindFirst(...a) },
    property: { findFirst: (...a: unknown[]) => propertyFindFirst(...a) },
    orgMember: {
      findFirst: (...a: unknown[]) => orgMemberFindFirst(...a),
      create: (...a: unknown[]) => orgMemberCreate(...a),
    },
    propertyResident: { findFirst: (...a: unknown[]) => propertyResidentFindFirst(...a) },
  },
}));

const checkMemberLimit = vi.fn();
vi.mock("@/lib/plan-gate", () => ({
  checkMemberLimit: (...a: unknown[]) => checkMemberLimit(...a),
}));

const createPtaHousehold = vi.fn();
const addPtaHouseholdAdult = vi.fn();
const addPtaStudent = vi.fn();
vi.mock("@/lib/labs/pta/households", () => ({
  createPtaHousehold: (...a: unknown[]) => createPtaHousehold(...a),
  addPtaHouseholdAdult: (...a: unknown[]) => addPtaHouseholdAdult(...a),
  addPtaStudent: (...a: unknown[]) => addPtaStudent(...a),
}));

const createProperty = vi.fn();
const assignPropertyResident = vi.fn();
vi.mock("@/lib/hoa/properties", () => ({
  createProperty: (...a: unknown[]) => createProperty(...a),
  assignPropertyResident: (...a: unknown[]) => assignPropertyResident(...a),
}));

const actor = { actorUserId: "user-1", actorEmail: "board@example.org" };

beforeEach(() => {
  vi.clearAllMocks();
  ptaHouseholdFindFirst.mockResolvedValue(null);
  propertyFindFirst.mockResolvedValue(null);
  orgMemberFindFirst.mockResolvedValue(null);
  propertyResidentFindFirst.mockResolvedValue(null);
  createPtaHousehold.mockImplementation(async (input: { displayName: string }) => ({ id: `household-${input.displayName}` }));
  createProperty.mockImplementation(async (input: { addressLine1: string }) => ({ id: `property-${input.addressLine1}` }));
  orgMemberCreate.mockImplementation(async ({ data }: { data: { firstName: string } }) => ({ id: `member-${data.firstName}` }));
});

describe("importPtaHouseholds", () => {
  it("creates a household with its primary contact and students", async () => {
    const { importPtaHouseholds } = await import("../vertical-import");
    const rows = [
      { "Household Name": "The Smiths", "School Year": "2026-2027", "Contact Name": "Jordan Smith", "Student Names": "Ava; Ben" },
    ];
    const mapping = { "Household Name": "householdName", "School Year": "schoolYear", "Contact Name": "contactName", "Student Names": "studentNames" };

    const results = await importPtaHouseholds(rows, mapping, "org-1", actor.actorUserId, actor.actorEmail, false);

    expect(results).toEqual([{ row: 2, status: "ok" }]);
    expect(createPtaHousehold).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", displayName: "The Smiths", schoolYear: "2026-2027" })
    );
    expect(addPtaHouseholdAdult).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: "household-The Smiths", name: "Jordan Smith", makePrimaryContact: true })
    );
    expect(addPtaStudent).toHaveBeenCalledTimes(2);
    expect(addPtaStudent).toHaveBeenNthCalledWith(1, expect.objectContaining({ displayName: "Ava" }));
    expect(addPtaStudent).toHaveBeenNthCalledWith(2, expect.objectContaining({ displayName: "Ben" }));
  });

  it("skips (does not duplicate) a household already matched by name + school year", async () => {
    ptaHouseholdFindFirst.mockResolvedValueOnce({ id: "existing-household" });
    const { importPtaHouseholds } = await import("../vertical-import");
    const rows = [{ householdName: "The Smiths", schoolYear: "2026-2027", contactName: "Jordan Smith" }];

    const results = await importPtaHouseholds(rows, {}, "org-1", actor.actorUserId, actor.actorEmail, false);

    expect(results).toEqual([{ row: 2, status: "ok" }]);
    expect(createPtaHousehold).not.toHaveBeenCalled();
    expect(addPtaHouseholdAdult).not.toHaveBeenCalled();
  });

  it("errors a row missing a required field without touching the database", async () => {
    const { importPtaHouseholds } = await import("../vertical-import");
    const rows = [{ householdName: "", schoolYear: "2026-2027", contactName: "Jordan Smith" }];

    const results = await importPtaHouseholds(rows, {}, "org-1", actor.actorUserId, actor.actorEmail, false);

    expect(results).toEqual([{ row: 2, status: "error", message: "Household name is required" }]);
    expect(ptaHouseholdFindFirst).not.toHaveBeenCalled();
  });

  it("surfaces a PtaError's message as the row error rather than swallowing it", async () => {
    const { PtaError } = await import("@/lib/labs/pta/errors");
    createPtaHousehold.mockRejectedValueOnce(new PtaError("PTA_VALIDATION_ERROR", "Household display name is required."));
    const { importPtaHouseholds } = await import("../vertical-import");
    const rows = [{ householdName: "The Smiths", schoolYear: "2026-2027", contactName: "Jordan Smith" }];

    const results = await importPtaHouseholds(rows, {}, "org-1", actor.actorUserId, actor.actorEmail, false);

    expect(results).toEqual([{ row: 2, status: "error", message: "Household display name is required." }]);
  });

  it("preview mode validates without calling the database", async () => {
    const { importPtaHouseholds } = await import("../vertical-import");
    const rows = [{ householdName: "The Smiths", schoolYear: "2026-2027", contactName: "Jordan Smith" }];

    const results = await importPtaHouseholds(rows, {}, "org-1", actor.actorUserId, actor.actorEmail, true);

    expect(results).toEqual([{ row: 2, status: "ok" }]);
    expect(ptaHouseholdFindFirst).not.toHaveBeenCalled();
    expect(createPtaHousehold).not.toHaveBeenCalled();
  });
});

describe("importHoaProperties", () => {
  it("creates a property and links a new owner", async () => {
    checkMemberLimit.mockResolvedValueOnce({ current: 5, limit: 500 });
    const { importHoaProperties } = await import("../vertical-import");
    const rows = [{ addressLine1: "142 Oak Ridge Drive", ownerFirstName: "Taylor", ownerLastName: "Brooks", ownerEmail: "taylor@example.org" }];

    const results = await importHoaProperties(rows, {}, "org-1", actor.actorUserId, actor.actorEmail, false);

    expect(results).toEqual([{ row: 2, status: "ok" }]);
    expect(createProperty).toHaveBeenCalledWith(expect.objectContaining({ addressLine1: "142 Oak Ridge Drive" }));
    expect(orgMemberCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ firstName: "Taylor", lastName: "Brooks", email: "taylor@example.org" }) })
    );
    expect(assignPropertyResident).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: "property-142 Oak Ridge Drive", orgMemberId: "member-Taylor", relationshipType: "OWNER", isPrimaryContact: true })
    );
  });

  it("matches an existing member by email instead of creating a duplicate", async () => {
    checkMemberLimit.mockResolvedValueOnce({ current: 5, limit: 500 });
    orgMemberFindFirst.mockResolvedValueOnce({ id: "existing-member" });
    const { importHoaProperties } = await import("../vertical-import");
    const rows = [{ addressLine1: "142 Oak Ridge Drive", ownerFirstName: "Taylor", ownerEmail: "taylor@example.org" }];

    const results = await importHoaProperties(rows, {}, "org-1", actor.actorUserId, actor.actorEmail, false);

    expect(results).toEqual([{ row: 2, status: "ok" }]);
    expect(orgMemberCreate).not.toHaveBeenCalled();
    expect(assignPropertyResident).toHaveBeenCalledWith(expect.objectContaining({ orgMemberId: "existing-member" }));
  });

  it("does not recreate a property already matched by address + unit", async () => {
    checkMemberLimit.mockResolvedValueOnce({ current: 5, limit: 500 });
    propertyFindFirst.mockResolvedValueOnce({ id: "existing-property" });
    const { importHoaProperties } = await import("../vertical-import");
    const rows = [{ addressLine1: "142 Oak Ridge Drive" }];

    const results = await importHoaProperties(rows, {}, "org-1", actor.actorUserId, actor.actorEmail, false);

    expect(results).toEqual([{ row: 2, status: "ok" }]);
    expect(createProperty).not.toHaveBeenCalled();
  });

  it("does not re-assign a resident who already has an active relationship to the property (re-import safety)", async () => {
    checkMemberLimit.mockResolvedValueOnce({ current: 5, limit: 500 });
    propertyFindFirst.mockResolvedValueOnce({ id: "existing-property" });
    orgMemberFindFirst.mockResolvedValueOnce({ id: "existing-member" });
    propertyResidentFindFirst.mockResolvedValueOnce({ id: "existing-relationship" });
    const { importHoaProperties } = await import("../vertical-import");
    const rows = [{ addressLine1: "142 Oak Ridge Drive", ownerFirstName: "Taylor", ownerEmail: "taylor@example.org" }];

    const results = await importHoaProperties(rows, {}, "org-1", actor.actorUserId, actor.actorEmail, false);

    expect(results).toEqual([{ row: 2, status: "ok" }]);
    expect(assignPropertyResident).not.toHaveBeenCalled();
  });

  it("creates a property with no owner row when owner fields are blank", async () => {
    checkMemberLimit.mockResolvedValueOnce({ current: 5, limit: 500 });
    const { importHoaProperties } = await import("../vertical-import");
    const rows = [{ addressLine1: "1 Oak Ridge Commons" }];

    const results = await importHoaProperties(rows, {}, "org-1", actor.actorUserId, actor.actorEmail, false);

    expect(results).toEqual([{ row: 2, status: "ok" }]);
    expect(orgMemberCreate).not.toHaveBeenCalled();
    expect(assignPropertyResident).not.toHaveBeenCalled();
  });

  it("errors a row missing the required street address without touching the database", async () => {
    checkMemberLimit.mockResolvedValueOnce({ current: 5, limit: 500 });
    const { importHoaProperties } = await import("../vertical-import");
    const rows = [{ addressLine1: "" }];

    const results = await importHoaProperties(rows, {}, "org-1", actor.actorUserId, actor.actorEmail, false);

    expect(results).toEqual([{ row: 2, status: "error", message: "Street address is required" }]);
    expect(propertyFindFirst).not.toHaveBeenCalled();
  });

  it("reports a per-row error and skips owner-linking once the member limit is reached, but still creates the property", async () => {
    checkMemberLimit.mockResolvedValueOnce({ current: 500, limit: 500 });
    const { importHoaProperties } = await import("../vertical-import");
    const rows = [{ addressLine1: "142 Oak Ridge Drive", ownerFirstName: "Taylor", ownerEmail: "taylor@example.org" }];

    const results = await importHoaProperties(rows, {}, "org-1", actor.actorUserId, actor.actorEmail, false);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("error");
    expect(results[0].message).toContain("member limit reached");
    expect(createProperty).toHaveBeenCalled();
    expect(assignPropertyResident).not.toHaveBeenCalled();
  });

  it("maps free-text property type and relationship type to the correct enum values", async () => {
    checkMemberLimit.mockResolvedValueOnce({ current: 5, limit: 500 });
    const { importHoaProperties } = await import("../vertical-import");
    const rows = [{ addressLine1: "88 Ridge Commons", propertyType: "Condo", ownerFirstName: "Dana", relationshipType: "Non-resident owner" }];

    await importHoaProperties(rows, {}, "org-1", actor.actorUserId, actor.actorEmail, false);

    expect(createProperty).toHaveBeenCalledWith(expect.objectContaining({ propertyType: "CONDO_UNIT" }));
    expect(assignPropertyResident).toHaveBeenCalledWith(expect.objectContaining({ relationshipType: "NON_RESIDENT_OWNER" }));
  });

  it("surfaces a HoaError's message as the row error rather than swallowing it", async () => {
    checkMemberLimit.mockResolvedValueOnce({ current: 5, limit: 500 });
    const { HoaError } = await import("@/lib/hoa/errors");
    createProperty.mockRejectedValueOnce(new HoaError("HOA_VALIDATION_ERROR", "Street address is required."));
    const { importHoaProperties } = await import("../vertical-import");
    const rows = [{ addressLine1: "142 Oak Ridge Drive" }];

    const results = await importHoaProperties(rows, {}, "org-1", actor.actorUserId, actor.actorEmail, false);

    expect(results).toEqual([{ row: 2, status: "error", message: "Street address is required." }]);
  });

  it("preview mode validates without calling checkMemberLimit or the database", async () => {
    const { importHoaProperties } = await import("../vertical-import");
    const rows = [{ addressLine1: "142 Oak Ridge Drive" }];

    const results = await importHoaProperties(rows, {}, "org-1", actor.actorUserId, actor.actorEmail, true);

    expect(results).toEqual([{ row: 2, status: "ok" }]);
    expect(checkMemberLimit).not.toHaveBeenCalled();
    expect(propertyFindFirst).not.toHaveBeenCalled();
  });
});
