import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrgSettings = vi.fn();
const findFirstHousehold = vi.fn();
const createHouseholdRow = vi.fn();
const findFirstOrgMember = vi.fn();
const updateOrgMember = vi.fn();
const findManyContributions = vi.fn();
const findFirstStatement = vi.fn();
const createStatement = vi.fn();
const updateStatement = vi.fn();
const findUniqueOrg = vi.fn();
const uploadBufferToSpaces = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    household: {
      findFirst: (...a: unknown[]) => findFirstHousehold(...a),
      create: (...a: unknown[]) => createHouseholdRow(...a),
    },
    orgMember: {
      findFirst: (...a: unknown[]) => findFirstOrgMember(...a),
      update: (...a: unknown[]) => updateOrgMember(...a),
    },
    contribution: { findMany: (...a: unknown[]) => findManyContributions(...a) },
    contributionStatement: {
      findFirst: (...a: unknown[]) => findFirstStatement(...a),
      create: (...a: unknown[]) => createStatement(...a),
      update: (...a: unknown[]) => updateStatement(...a),
    },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrg(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));
vi.mock("@/lib/storage", () => ({
  buildSafeObjectKey: (prefix: string, name: string) => `${prefix}/mock/${name}`,
  uploadBufferToSpaces: (...args: unknown[]) => uploadBufferToSpaces(...args),
}));

import { createHousehold, getMyHouseholdGiving, setHouseholdMembership } from "@/lib/giving/households";
import { generateHouseholdStatement } from "@/lib/giving/statements";

function orgSettings(overrides: Record<string, unknown> = {}) {
  return {
    contributionsEnabled: true,
    householdGivingEnabled: true,
    householdGivingPrivacyMode: "HOUSEHOLD_SHARED",
    ...overrides,
  };
}

const HOUSEHOLD = {
  id: "hh-1",
  organizationId: "org-1",
  name: "Rivera Household",
  members: [
    { id: "m-a", firstName: "Alex", lastName: "Rivera", userId: "u-a" },
    { id: "m-b", firstName: "Blake", lastName: "Rivera", userId: "u-b" },
  ],
};

function contributionRow(memberId: string, amount: number) {
  return {
    memberId,
    amount,
    contributionDate: new Date("2026-03-01"),
    goodsServicesValue: null,
    taxDeductibilityClassification: "DEDUCTIBILITY_NOT_CONFIGURED",
    fund: { name: "General Fund" },
    campaign: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrgSettings.mockResolvedValue(orgSettings());
  findUniqueOrg.mockResolvedValue({ name: "Demo Org" });
  createStatement.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "st-hh", ...args.data }));
});

describe("§29 privacy-mode gate (the single enforcement point)", () => {
  it("household giving disabled → NONE, and no member/contribution query even runs", async () => {
    findUniqueOrgSettings.mockResolvedValue(orgSettings({ householdGivingEnabled: false }));
    await expect(getMyHouseholdGiving("org-1", "m-a", 2026)).resolves.toEqual({ visibility: "NONE" });
    expect(findFirstOrgMember).not.toHaveBeenCalled();
    expect(findManyContributions).not.toHaveBeenCalled();
  });

  it("INDIVIDUAL_PRIVATE → NONE even when the flag is on — the default changes nothing", async () => {
    findUniqueOrgSettings.mockResolvedValue(orgSettings({ householdGivingPrivacyMode: "INDIVIDUAL_PRIVATE" }));
    await expect(getMyHouseholdGiving("org-1", "m-a", 2026)).resolves.toEqual({ visibility: "NONE" });
    expect(findManyContributions).not.toHaveBeenCalled();
  });

  it("STATEMENT_ONLY → per-member totals but NO transaction rows", async () => {
    findUniqueOrgSettings.mockResolvedValue(orgSettings({ householdGivingPrivacyMode: "HOUSEHOLD_STATEMENT_ONLY" }));
    findFirstOrgMember.mockResolvedValueOnce({ householdId: "hh-1" });
    findFirstHousehold.mockResolvedValueOnce(HOUSEHOLD);
    findManyContributions.mockResolvedValueOnce([contributionRow("m-a", 100), contributionRow("m-b", 40)]);
    const view = await getMyHouseholdGiving("org-1", "m-a", 2026);
    expect(view.visibility).toBe("TOTALS");
    expect(view).not.toHaveProperty("contributions");
    if (view.visibility === "TOTALS") {
      expect(view.householdTotal).toBe(140);
      expect(view.memberSubtotals.find((subtotal) => subtotal.isSelf)?.total).toBe(100);
    }
  });

  it("SHARED → transactions with member names, capped", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ householdId: "hh-1" });
    findFirstHousehold.mockResolvedValueOnce(HOUSEHOLD);
    findManyContributions.mockResolvedValueOnce([contributionRow("m-b", 40)]);
    const view = await getMyHouseholdGiving("org-1", "m-a", 2026);
    expect(view.visibility).toBe("SHARED");
    if (view.visibility === "SHARED") {
      expect(view.contributions[0]).toMatchObject({ memberName: "Blake Rivera", amount: 40, designation: "General Fund" });
    }
  });
});

describe("the household is never client-supplied", () => {
  it("derives the household from the CALLER'S OWN member row, scoped to the org", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ householdId: "hh-1" });
    findFirstHousehold.mockResolvedValueOnce(HOUSEHOLD);
    findManyContributions.mockResolvedValueOnce([]);
    await getMyHouseholdGiving("org-1", "m-a", 2026);
    expect(findFirstOrgMember.mock.calls[0][0].where).toMatchObject({ id: "m-a", organizationId: "org-1" });
    expect(findFirstHousehold.mock.calls[0][0].where).toMatchObject({ id: "hh-1", organizationId: "org-1" });
    // The contribution query is bounded to the household's member ids.
    expect(findManyContributions.mock.calls[0][0].where.memberId).toEqual({ in: ["m-a", "m-b"] });
  });

  it("a caller with no household gets NONE, not someone else's data", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ householdId: null });
    await expect(getMyHouseholdGiving("org-1", "m-a", 2026)).resolves.toEqual({ visibility: "NONE" });
    expect(findManyContributions).not.toHaveBeenCalled();
  });
});

describe("household administration", () => {
  it("duplicate household name → 409", async () => {
    createHouseholdRow.mockRejectedValueOnce({ code: "P2002" });
    await expect(
      createHousehold({ organizationId: "org-1", name: "Rivera Household", actorUserId: "adm-1" })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("membership changes are org-scoped: cross-org household or member → 404, nothing written", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    await expect(
      setHouseholdMembership({ organizationId: "org-1", householdId: "hh-other-org", memberId: "m-a", action: "add", actorUserId: "adm-1" })
    ).rejects.toMatchObject({ status: 404 });

    findFirstHousehold.mockResolvedValueOnce(HOUSEHOLD);
    findFirstOrgMember.mockResolvedValueOnce(null);
    await expect(
      setHouseholdMembership({ organizationId: "org-1", householdId: "hh-1", memberId: "m-other-org", action: "add", actorUserId: "adm-1" })
    ).rejects.toMatchObject({ status: 404 });
    expect(updateOrgMember).not.toHaveBeenCalled();
  });

  it("add and remove both audit", async () => {
    findFirstHousehold.mockResolvedValue(HOUSEHOLD);
    findFirstOrgMember.mockResolvedValue({ id: "m-a", organizationId: "org-1" });
    await setHouseholdMembership({ organizationId: "org-1", householdId: "hh-1", memberId: "m-a", action: "add", actorUserId: "adm-1" });
    expect(updateOrgMember.mock.calls[0][0].data).toEqual({ householdId: "hh-1" });
    await setHouseholdMembership({ organizationId: "org-1", householdId: "hh-1", memberId: "m-a", action: "remove", actorUserId: "adm-1" });
    expect(updateOrgMember.mock.calls[1][0].data).toEqual({ householdId: null });
    expect(createAuditEvent).toHaveBeenCalledTimes(2);
  });
});

describe("household statements respect the mode", () => {
  it("refused outright when the mode is INDIVIDUAL_PRIVATE or the feature is off", async () => {
    findUniqueOrgSettings.mockResolvedValue(orgSettings({ householdGivingPrivacyMode: "INDIVIDUAL_PRIVATE" }));
    await expect(
      generateHouseholdStatement({ organizationId: "org-1", householdId: "hh-1", year: 2026, generatedByUserId: "fin-1" })
    ).rejects.toMatchObject({ status: 409 });
    expect(uploadBufferToSpaces).not.toHaveBeenCalled();
    expect(createStatement).not.toHaveBeenCalled();
  });

  it("generates in STATEMENT_ONLY mode, stamped with the householdId", async () => {
    findUniqueOrgSettings.mockResolvedValue(orgSettings({ householdGivingPrivacyMode: "HOUSEHOLD_STATEMENT_ONLY" }));
    findFirstHousehold.mockResolvedValueOnce(HOUSEHOLD);
    findManyContributions.mockResolvedValueOnce([contributionRow("m-a", 100)]);
    findFirstStatement.mockResolvedValueOnce(null);
    const statement = await generateHouseholdStatement({
      organizationId: "org-1",
      householdId: "hh-1",
      year: 2026,
      generatedByUserId: "fin-1",
    });
    expect(statement).toMatchObject({ householdId: "hh-1", version: 1 });
    expect(uploadBufferToSpaces).toHaveBeenCalled();
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "giving.household_statement_generated" })
    );
  });

  it("cross-org household → 404", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    await expect(
      generateHouseholdStatement({ organizationId: "org-1", householdId: "hh-other", year: 2026, generatedByUserId: "fin-1" })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("reissue requires a reason and supersedes the prior version", async () => {
    findFirstHousehold.mockResolvedValue(HOUSEHOLD);
    findManyContributions.mockResolvedValue([contributionRow("m-a", 100)]);
    findFirstStatement.mockResolvedValueOnce({ id: "st-old", version: 1 });
    await expect(
      generateHouseholdStatement({ organizationId: "org-1", householdId: "hh-1", year: 2026, generatedByUserId: "fin-1" })
    ).rejects.toMatchObject({ status: 409 });

    findFirstStatement.mockResolvedValueOnce({ id: "st-old", version: 1 });
    const second = await generateHouseholdStatement({
      organizationId: "org-1",
      householdId: "hh-1",
      year: 2026,
      reason: "Added a missed check",
      generatedByUserId: "fin-1",
    });
    expect(second.version).toBe(2);
    expect(updateStatement.mock.calls[0][0]).toMatchObject({
      where: { id: "st-old" },
      data: { status: "SUPERSEDED", supersededById: "st-hh" },
    });
  });
});
