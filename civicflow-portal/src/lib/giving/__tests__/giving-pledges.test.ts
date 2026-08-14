import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrgSettings = vi.fn();
const findFirstFund = vi.fn();
const findFirstCampaign = vi.fn();
const findFirstPledge = vi.fn();
const findManyPledges = vi.fn();
const createPledgeRow = vi.fn();
const updatePledgeRow = vi.fn();
const aggregateContributions = vi.fn();
const aggregatePledges = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    fund: { findFirst: (...a: unknown[]) => findFirstFund(...a) },
    campaign: { findFirst: (...a: unknown[]) => findFirstCampaign(...a) },
    pledge: {
      findFirst: (...a: unknown[]) => findFirstPledge(...a),
      findMany: (...a: unknown[]) => findManyPledges(...a),
      create: (...a: unknown[]) => createPledgeRow(...a),
      update: (...a: unknown[]) => updatePledgeRow(...a),
      aggregate: (...a: unknown[]) => aggregatePledges(...a),
    },
    contribution: { aggregate: (...a: unknown[]) => aggregateContributions(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import {
  campaignPledgeTotals,
  cancelPledge,
  createPledge,
  listMyPledges,
  markFulfilledIfComplete,
  validatePledgeForGiving,
  verifyPledgeLinkage,
} from "@/lib/giving/pledges";

const actor = { actorUserId: "u1" };

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrgSettings.mockResolvedValue({ contributionsEnabled: true });
  createPledgeRow.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "pl1", ...args.data }));
  aggregateContributions.mockResolvedValue({ _sum: { amount: 0 } });
});

describe("pledge creation (§22)", () => {
  it("requires an ACTIVE fund with allowPledges", async () => {
    findFirstFund.mockResolvedValueOnce({ id: "f1", name: "General", status: "ACTIVE", allowPledges: false });
    await expect(
      createPledge({ organizationId: "org-1", contributorUserId: "u1", fundId: "f1", pledgedAmount: 1200, ...actor })
    ).rejects.toMatchObject({ status: 409 });

    findFirstFund.mockResolvedValueOnce(null);
    await expect(
      createPledge({ organizationId: "org-1", contributorUserId: "u1", fundId: "foreign", pledgedAmount: 1200, ...actor })
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("progress & the remaining language (§22)", () => {
  it("computes Remaining toward pledge — never an owed amount, never negative", async () => {
    findManyPledges.mockResolvedValueOnce([
      {
        id: "pl1",
        pledgedAmount: 2000,
        status: "ACTIVE",
        pledgeDate: new Date(),
        targetCompletionDate: null,
        fund: { id: "f1", name: "Building Fund" },
        campaign: null,
      },
    ]);
    aggregateContributions.mockResolvedValueOnce({ _sum: { amount: 1250 } });
    const [view] = await listMyPledges("org-1", "u1");
    expect(view).toMatchObject({ pledged: 2000, contributed: 1250, remainingTowardPledge: 750, progressPercent: 62.5 });
    expect(Object.keys(view)).not.toContain("amountOwed");

    findManyPledges.mockResolvedValueOnce([
      { id: "pl2", pledgedAmount: 100, status: "FULFILLED", pledgeDate: new Date(), targetCompletionDate: null, fund: { id: "f1", name: "F" }, campaign: null },
    ]);
    aggregateContributions.mockResolvedValueOnce({ _sum: { amount: 150 } });
    const [over] = await listMyPledges("org-1", "u1");
    expect(over.remainingTowardPledge).toBe(0);
  });
});

describe("allocation guards (§23/§50)", () => {
  it("checkout-time: the pledge must be the caller's, active, and on the SAME fund", async () => {
    findFirstPledge.mockResolvedValueOnce(null);
    await expect(
      validatePledgeForGiving({ organizationId: "org-1", contributorUserId: "u1", pledgeId: "foreign", fundId: "f1" })
    ).rejects.toMatchObject({ status: 404 });
    expect(findFirstPledge.mock.calls[0][0].where).toMatchObject({ id: "foreign", organizationId: "org-1", contributorUserId: "u1" });

    findFirstPledge.mockResolvedValueOnce({ id: "pl1", status: "ACTIVE", fundId: "OTHER" });
    await expect(
      validatePledgeForGiving({ organizationId: "org-1", contributorUserId: "u1", pledgeId: "pl1", fundId: "f1" })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("webhook-time: a mismatched pledge yields null (credit withheld) — never an error that blocks the contribution", async () => {
    findFirstPledge.mockResolvedValueOnce(null);
    await expect(
      verifyPledgeLinkage({ organizationId: "org-1", pledgeId: "foreign", fundId: "f1", contributorUserId: "u1" })
    ).resolves.toBeNull();

    findFirstPledge.mockResolvedValueOnce({ id: "pl1", contributorUserId: "someone-else" });
    await expect(
      verifyPledgeLinkage({ organizationId: "org-1", pledgeId: "pl1", fundId: "f1", contributorUserId: "u1" })
    ).resolves.toBeNull();

    findFirstPledge.mockResolvedValueOnce({ id: "pl1", contributorUserId: "u1" });
    await expect(
      verifyPledgeLinkage({ organizationId: "org-1", pledgeId: "pl1", fundId: "f1", contributorUserId: "u1" })
    ).resolves.toBe("pl1");
  });
});

describe("fulfillment", () => {
  it("flips ACTIVE→FULFILLED exactly once when the live sum crosses the pledge", async () => {
    findFirstPledge.mockResolvedValueOnce({ id: "pl1", organizationId: "org-1", status: "ACTIVE", pledgedAmount: 1000, contributorUserId: "u1" });
    aggregateContributions.mockResolvedValueOnce({ _sum: { amount: 1000 } });
    await markFulfilledIfComplete("org-1", "pl1");
    expect(updatePledgeRow.mock.calls[0][0].data).toEqual({ status: "FULFILLED" });

    // Already fulfilled → no second flip.
    findFirstPledge.mockResolvedValueOnce({ id: "pl1", organizationId: "org-1", status: "FULFILLED", pledgedAmount: 1000 });
    await markFulfilledIfComplete("org-1", "pl1");
    expect(updatePledgeRow).toHaveBeenCalledTimes(1);
  });
});

describe("cancellation is never debt (§22/§111.1)", () => {
  it("member cancels their own pledge; foreign pledges 404; idempotent; nothing owed anywhere", async () => {
    findFirstPledge.mockResolvedValueOnce(null);
    await expect(cancelPledge({ organizationId: "org-1", contributorUserId: "u1", pledgeId: "foreign", ...actor })).rejects.toMatchObject({
      status: 404,
    });

    findFirstPledge.mockResolvedValueOnce({ id: "pl1", status: "ACTIVE" });
    updatePledgeRow.mockResolvedValueOnce({ id: "pl1", status: "CANCELLED" });
    const cancelled = await cancelPledge({ organizationId: "org-1", contributorUserId: "u1", pledgeId: "pl1", ...actor });
    expect(cancelled.status).toBe("CANCELLED");

    findFirstPledge.mockResolvedValueOnce({ id: "pl1", status: "CANCELLED" });
    await cancelPledge({ organizationId: "org-1", contributorUserId: "u1", pledgeId: "pl1", ...actor });
    expect(updatePledgeRow).toHaveBeenCalledTimes(1);
  });
});

describe("campaign totals (§24)", () => {
  it("computes pledged and received-toward-pledges without storing either", async () => {
    aggregatePledges.mockResolvedValueOnce({ _sum: { pledgedAmount: 250000 }, _count: 96 });
    aggregateContributions.mockResolvedValueOnce({ _sum: { amount: 102500 } });
    const totals = await campaignPledgeTotals("org-1", "camp-1");
    expect(totals).toEqual({ pledgeCount: 96, totalPledged: 250000, receivedTowardPledges: 102500 });
  });
});
