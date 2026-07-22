import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstHousehold = vi.fn();
const createHousehold = vi.fn();
const updateHousehold = vi.fn();
const deleteHousehold = vi.fn();
const createOrgMember = vi.fn();
const countDuesCharge = vi.fn();
const findFirstAdult = vi.fn();
const createAdult = vi.fn();
const updateHouseholdAdult = vi.fn();
const deleteAdult = vi.fn();
const findFirstStudent = vi.fn();
const createStudent = vi.fn();
const updateStudent = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHousehold: { findFirst: (...a: unknown[]) => findFirstHousehold(...a), create: (...a: unknown[]) => createHousehold(...a), update: (...a: unknown[]) => updateHousehold(...a), delete: (...a: unknown[]) => deleteHousehold(...a) },
    orgMember: { create: (...a: unknown[]) => createOrgMember(...a), update: vi.fn() },
    duesCharge: { count: (...a: unknown[]) => countDuesCharge(...a) },
    ptaHouseholdAdult: { findFirst: (...a: unknown[]) => findFirstAdult(...a), create: (...a: unknown[]) => createAdult(...a), update: (...a: unknown[]) => updateHouseholdAdult(...a), delete: (...a: unknown[]) => deleteAdult(...a) },
    ptaStudent: { findFirst: (...a: unknown[]) => findFirstStudent(...a), create: (...a: unknown[]) => createStudent(...a), update: (...a: unknown[]) => updateStudent(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => vi.clearAllMocks());

describe("createPtaHousehold", () => {
  it("creates a billing-identity OrgMember and links it to the household", async () => {
    createOrgMember.mockResolvedValueOnce({ id: "member-1" });
    createHousehold.mockResolvedValueOnce({ id: "household-1", orgMemberId: "member-1" });

    const { createPtaHousehold } = await import("../households");
    const result = await createPtaHousehold({ organizationId: "org-a", displayName: "The Test Household", schoolYear: "2026-2027", actorUserId: "u1" });

    expect(createOrgMember).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-a", householdName: "The Test Household" }) }));
    expect(createHousehold).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orgMemberId: "member-1" }) }));
    expect(result.orgMemberId).toBe("member-1");
  });

  it("rejects an empty display name without ever touching the database", async () => {
    const { createPtaHousehold } = await import("../households");
    await expect(createPtaHousehold({ organizationId: "org-a", displayName: "   ", schoolYear: "2026-2027", actorUserId: "u1" })).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(createOrgMember).not.toHaveBeenCalled();
  });
});

describe("tenant isolation — cross-organization household access denied", () => {
  it("getPtaHousehold cannot read another organization's household", async () => {
    findFirstHousehold.mockResolvedValueOnce(null); // simulates the real where-clause exclusion
    const { getPtaHousehold } = await import("../households");
    await expect(getPtaHousehold("org-b", "household-belonging-to-org-a")).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
    expect(findFirstHousehold).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "household-belonging-to-org-a", organizationId: "org-b" } }));
  });

  it("updatePtaHousehold cannot update another organization's household", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    const { updatePtaHousehold } = await import("../households");
    await expect(updatePtaHousehold({ organizationId: "org-b", householdId: "household-belonging-to-org-a", displayName: "Hijacked", actorUserId: "u1" })).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
    expect(updateHousehold).not.toHaveBeenCalled();
  });

  it("deactivatePtaHousehold cannot deactivate another organization's household", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    const { deactivatePtaHousehold } = await import("../households");
    await expect(deactivatePtaHousehold("org-b", "household-belonging-to-org-a", "u1")).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
  });

  it("addPtaHouseholdAdult cannot attach an adult to another organization's household", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    const { addPtaHouseholdAdult } = await import("../households");
    await expect(addPtaHouseholdAdult({ organizationId: "org-b", householdId: "household-belonging-to-org-a", name: "Attacker", actorUserId: "u1" })).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
    expect(createAdult).not.toHaveBeenCalled();
  });

  it("addPtaStudent cannot attach a student to another organization's household", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    const { addPtaStudent } = await import("../households");
    await expect(addPtaStudent({ organizationId: "org-b", householdId: "household-belonging-to-org-a", displayName: "Some Kid", actorUserId: "u1" })).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
    expect(createStudent).not.toHaveBeenCalled();
  });
});

describe("deletePtaHousehold — payment-history preservation", () => {
  it("refuses a hard delete once any DuesCharge exists, preserving financial history", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    countDuesCharge.mockResolvedValueOnce(2);

    const { deletePtaHousehold } = await import("../households");
    await expect(deletePtaHousehold("org-a", "household-1", "u1")).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_HAS_PAYMENT_HISTORY" });
    expect(deleteHousehold).not.toHaveBeenCalled();
  });

  it("allows a hard delete when there is no dues history at all", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    countDuesCharge.mockResolvedValueOnce(0);
    deleteHousehold.mockResolvedValueOnce({ id: "household-1" });

    const { deletePtaHousehold } = await import("../households");
    await expect(deletePtaHousehold("org-a", "household-1", "u1")).resolves.toBeUndefined();
    expect(deleteHousehold).toHaveBeenCalledWith({ where: { id: "household-1" } });
  });
});

describe("addPtaStudent — data minimization", () => {
  it("audit metadata never includes the student's display name or any other field beyond stable identifiers", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a" });
    createStudent.mockResolvedValueOnce({ id: "student-1" });
    const { addPtaStudent } = await import("../households");
    await addPtaStudent({ organizationId: "org-a", householdId: "household-1", displayName: "Sensitive Kid Name", actorUserId: "u1" });

    const { createAuditEvent } = await import("@/lib/audit");
    const call = (createAuditEvent as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0] as { metadata: unknown; entityId: string };
    expect(call.entityId).toBe("student-1");
    expect(JSON.stringify(call.metadata)).not.toContain("Sensitive Kid Name");
  });
});
