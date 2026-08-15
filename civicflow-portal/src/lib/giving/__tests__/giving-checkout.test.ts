import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrgSettings = vi.fn();
const findFirstFund = vi.fn();
const findFirstProgram = vi.fn();
const findFirstContribution = vi.fn();
const createContribution = vi.fn();
const countContributions = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    fund: { findFirst: (...a: unknown[]) => findFirstFund(...a) },
    contributionProgram: { findFirst: (...a: unknown[]) => findFirstProgram(...a) },
    contribution: {
      findFirst: (...a: unknown[]) => findFirstContribution(...a),
      create: (...a: unknown[]) => createContribution(...a),
      count: (...a: unknown[]) => countContributions(...a),
    },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import { recordGivingContribution, validateGivingRequest } from "@/lib/giving/checkout";

const baseRecord = {
  organizationId: "org-1",
  fundId: "f1",
  amountTotalCents: 10000,
  currency: "usd",
  providerPaymentIntentId: "pi_123",
  providerSessionId: "cs_123",
  stripeConnectedAccountId: "acct_connected1",
};

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrgSettings.mockResolvedValue({ contributionsEnabled: true, contributionTerminology: null });
  countContributions.mockResolvedValue(0);
  createContribution.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "c1", ...args.data }));
});

describe("validateGivingRequest (checkout preconditions)", () => {
  it("refuses when the module is off, the fund is foreign, inactive, or one-time-closed", async () => {
    findUniqueOrgSettings.mockResolvedValueOnce({ contributionsEnabled: false });
    await expect(validateGivingRequest({ organizationId: "org-1", fundId: "f1", amount: 50 })).rejects.toMatchObject({ status: 403 });

    findFirstFund.mockResolvedValueOnce(null);
    await expect(validateGivingRequest({ organizationId: "org-1", fundId: "foreign", amount: 50 })).rejects.toMatchObject({ status: 404 });
    expect(findFirstFund.mock.calls[0][0].where).toMatchObject({ id: "foreign", organizationId: "org-1" });

    findFirstFund.mockResolvedValueOnce({ id: "f1", name: "Closed", status: "CLOSED", allowOneTime: true });
    await expect(validateGivingRequest({ organizationId: "org-1", fundId: "f1", amount: 50 })).rejects.toMatchObject({ status: 409 });

    findFirstFund.mockResolvedValueOnce({ id: "f1", name: "Pledge Only", status: "ACTIVE", allowOneTime: false });
    await expect(validateGivingRequest({ organizationId: "org-1", fundId: "f1", amount: 50 })).rejects.toMatchObject({ status: 409 });
  });

  it("enforces fund min/max and positive amounts", async () => {
    findFirstFund.mockResolvedValue({ id: "f1", name: "General", status: "ACTIVE", allowOneTime: true, minimumAmount: 10, maximumAmount: 500 });
    await expect(validateGivingRequest({ organizationId: "org-1", fundId: "f1", amount: 5 })).rejects.toMatchObject({ name: "FinanceError" });
    await expect(validateGivingRequest({ organizationId: "org-1", fundId: "f1", amount: 501 })).rejects.toMatchObject({ name: "FinanceError" });
    await expect(validateGivingRequest({ organizationId: "org-1", fundId: "f1", amount: 0 })).rejects.toMatchObject({ name: "FinanceError" });
    const ok = await validateGivingRequest({ organizationId: "org-1", fundId: "f1", amount: 50 });
    expect(ok.amount).toBe(50);
  });

  it("program must belong to the fund; fixed-amount programs pin the amount", async () => {
    findFirstFund.mockResolvedValue({ id: "f1", name: "General", status: "ACTIVE", allowOneTime: true, minimumAmount: null, maximumAmount: null });
    findFirstProgram.mockResolvedValueOnce({ id: "p1", fundId: "OTHER", status: "ACTIVE", allowCustomAmount: true, suggestedAmounts: [], name: "X" });
    await expect(
      validateGivingRequest({ organizationId: "org-1", fundId: "f1", amount: 50, programId: "p1" })
    ).rejects.toMatchObject({ status: 409 });

    findFirstProgram.mockResolvedValueOnce({ id: "p1", fundId: "f1", status: "ACTIVE", allowCustomAmount: false, suggestedAmounts: [25, 50], name: "Fixed" });
    await expect(
      validateGivingRequest({ organizationId: "org-1", fundId: "f1", amount: 40, programId: "p1" })
    ).rejects.toMatchObject({ name: "FinanceError" });
  });
});

describe("recordGivingContribution (webhook side)", () => {
  it("§50: fund/org mismatch records NOTHING and reports REJECTED", async () => {
    findFirstFund.mockResolvedValueOnce(null);
    const result = await recordGivingContribution(baseRecord);
    expect(result).toEqual({ outcome: "REJECTED", reason: "fund_org_mismatch" });
    expect(createContribution).not.toHaveBeenCalled();
  });

  it("closed/archived funds and invalid amounts are rejected at record time too", async () => {
    findFirstFund.mockResolvedValueOnce({ id: "f1", status: "ARCHIVED" });
    expect((await recordGivingContribution(baseRecord)).outcome).toBe("REJECTED");

    findFirstFund.mockResolvedValueOnce({ id: "f1", status: "ACTIVE" });
    expect((await recordGivingContribution({ ...baseRecord, amountTotalCents: 0 })).outcome).toBe("REJECTED");
  });

  it("program linkage is re-verified against org AND fund", async () => {
    findFirstFund.mockResolvedValueOnce({ id: "f1", status: "ACTIVE" });
    findFirstProgram.mockResolvedValueOnce(null);
    const result = await recordGivingContribution({ ...baseRecord, programId: "p-foreign" });
    expect(result).toEqual({ outcome: "REJECTED", reason: "program_linkage_mismatch" });
    expect(findFirstProgram.mock.calls[0][0].where).toMatchObject({ id: "p-foreign", organizationId: "org-1", fundId: "f1" });
  });

  it("duplicate payment intent yields DUPLICATE and no second row (§79/§111.7)", async () => {
    findFirstFund.mockResolvedValueOnce({ id: "f1", status: "ACTIVE" });
    findFirstContribution.mockResolvedValueOnce({ id: "existing" });
    const result = await recordGivingContribution(baseRecord);
    expect(result).toEqual({ outcome: "DUPLICATE", contributionId: "existing" });
    expect(createContribution).not.toHaveBeenCalled();
  });

  it("a clean session records the contribution with number, attribution, and provider truth for amount/currency", async () => {
    findFirstFund.mockResolvedValueOnce({ id: "f1", status: "ACTIVE" });
    findFirstContribution.mockResolvedValueOnce(null);
    const result = await recordGivingContribution({
      ...baseRecord,
      memberId: "m1",
      contributorUserId: "u1",
      anonymityMode: "PUBLICLY_ANONYMOUS",
      memo: "In honor of Coach P.",
    });
    expect(result.outcome).toBe("RECORDED");
    const data = createContribution.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organizationId: "org-1",
      fundId: "f1",
      memberId: "m1",
      contributorUserId: "u1",
      amount: 100,
      currency: "USD",
      providerPaymentIntentId: "pi_123",
      anonymityMode: "PUBLICLY_ANONYMOUS",
      source: "MEMBER_PROFILE",
      // CONNECT-C (§56): immutable connected-account attribution.
      stripeConnectedAccountId: "acct_connected1",
      providerAccountContext: "CONNECTED_ACCOUNT_PAYMENT",
    });
    expect(String(data.contributionNumber)).toMatch(/^CTR-\d{4}-\d{6}$/);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "giving.contribution_recorded" }));
  });

  it("unknown anonymity strings degrade to NONE, never to a fake promise", async () => {
    findFirstFund.mockResolvedValueOnce({ id: "f1", status: "ACTIVE" });
    findFirstContribution.mockResolvedValueOnce(null);
    await recordGivingContribution({ ...baseRecord, anonymityMode: "FULLY_SECRET" });
    expect(createContribution.mock.calls[0][0].data.anonymityMode).toBe("NONE");
  });
});
