import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstContribution = vi.fn();
const updateContribution = vi.fn();
const aggregateContributions = vi.fn();
const findFirstFund = vi.fn();
const findFirstOrgMember = vi.fn();
const createAdjustment = vi.fn();
const transaction = vi.fn();
const findUniqueOrgSettings = vi.fn();
const findUniqueStripeAccount = vi.fn();
const stripeRefundsCreate = vi.fn();
const stripeRefundsCreateConnected = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contribution: {
      findFirst: (...a: unknown[]) => findFirstContribution(...a),
      update: (...a: unknown[]) => updateContribution(...a),
      aggregate: (...a: unknown[]) => aggregateContributions(...a),
    },
    fund: { findFirst: (...a: unknown[]) => findFirstFund(...a) },
    orgMember: { findFirst: (...a: unknown[]) => findFirstOrgMember(...a) },
    contributionAdjustment: { create: (...a: unknown[]) => createAdjustment(...a) },
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    organizationStripeAccount: { findUnique: (...a: unknown[]) => findUniqueStripeAccount(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));
vi.mock("@/lib/stripe", () => ({ getStripe: () => ({ refunds: { create: (...a: unknown[]) => stripeRefundsCreate(...a) } }) }));
vi.mock("@/lib/payments/stripe-connect", () => ({
  getStripeForMode: async () => ({ refunds: { create: (...a: unknown[]) => stripeRefundsCreateConnected(...a) } }),
}));

import { adjustContribution, applyProviderRefund, issueRefund } from "@/lib/giving/refunds";
import { pledgeProgress } from "@/lib/giving/pledges";
import { logGivingEvent } from "@/lib/giving/telemetry";
import { reportToCsv } from "@/lib/giving/reports";

const PROVIDER_ROW = {
  id: "c-1",
  organizationId: "org-1",
  amount: 100,
  refundedAmount: null,
  voidedAt: null,
  providerPaymentIntentId: "pi_1",
  providerRefundId: null,
  refundedAt: null,
  paymentMethod: "STRIPE",
  memberId: null,
  contributorName: "Pat",
  fundId: "f-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrgSettings.mockResolvedValue({ contributionsEnabled: true });
  transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  createAdjustment.mockResolvedValue({ id: "adj-1" });
  updateContribution.mockResolvedValue({});
});

describe("issueRefund (§34)", () => {
  it("offline rows are refused — corrections stay in the offline flow", async () => {
    findFirstContribution.mockResolvedValueOnce({ ...PROVIDER_ROW, paymentMethod: "CHECK", providerPaymentIntentId: null });
    await expect(
      issueRefund({ organizationId: "org-1", contributionId: "c-1", reason: "test", actorUserId: "fin" })
    ).rejects.toMatchObject({ status: 409 });
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it("cumulative refunds cannot exceed the original amount", async () => {
    findFirstContribution.mockResolvedValueOnce({ ...PROVIDER_ROW, refundedAmount: 80 });
    await expect(
      issueRefund({ organizationId: "org-1", contributionId: "c-1", amount: 30, reason: "too much", actorUserId: "fin" })
    ).rejects.toMatchObject({ status: 409 });
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  describe("CONNECT-F: coverage-inclusive refund ceiling", () => {
    it("a covered contribution can be refunded up to totalChargedAmount, not just the base `amount`", async () => {
      findFirstContribution.mockResolvedValueOnce({
        ...PROVIDER_ROW,
        amount: 100,
        processingCostCoverageAmount: 3.3,
        totalChargedAmount: 103.3,
      });
      stripeRefundsCreate.mockResolvedValueOnce({ id: "re_full", status: "succeeded", amount: 10330 });
      findFirstContribution.mockResolvedValueOnce({
        ...PROVIDER_ROW,
        amount: 100,
        processingCostCoverageAmount: 3.3,
        totalChargedAmount: 103.3,
      });
      const result = await issueRefund({
        organizationId: "org-1",
        contributionId: "c-1",
        amount: 103.3,
        reason: "full refund including coverage",
        actorUserId: "fin",
      });
      expect(result.marked).toBe(true);
      expect(stripeRefundsCreate.mock.calls[0][0]).toMatchObject({ amount: 10330 });
    });

    it("a covered contribution's refund still caps at totalChargedAmount — cannot exceed what was actually charged", async () => {
      findFirstContribution.mockResolvedValueOnce({
        ...PROVIDER_ROW,
        amount: 100,
        processingCostCoverageAmount: 3.3,
        totalChargedAmount: 103.3,
      });
      await expect(
        issueRefund({ organizationId: "org-1", contributionId: "c-1", amount: 110, reason: "too much", actorUserId: "fin" })
      ).rejects.toMatchObject({ status: 409 });
      expect(stripeRefundsCreate).not.toHaveBeenCalled();
    });

    it("a legacy row with no totalChargedAmount still caps at `amount` — unchanged pre-CONNECT-F behavior", async () => {
      findFirstContribution.mockResolvedValueOnce({ ...PROVIDER_ROW, amount: 100, totalChargedAmount: null });
      await expect(
        issueRefund({ organizationId: "org-1", contributionId: "c-1", amount: 101, reason: "too much", actorUserId: "fin" })
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  it("a synchronous provider success marks the row from provider truth", async () => {
    findFirstContribution.mockResolvedValueOnce(PROVIDER_ROW);
    stripeRefundsCreate.mockResolvedValueOnce({ id: "re_1", status: "succeeded", amount: 2500 });
    findFirstContribution.mockResolvedValueOnce(PROVIDER_ROW); // applyProviderRefund lookup
    const result = await issueRefund({
      organizationId: "org-1",
      contributionId: "c-1",
      amount: 25,
      reason: "duplicate gift",
      actorUserId: "fin",
    });
    expect(result.marked).toBe(true);
    expect(stripeRefundsCreate.mock.calls[0][0]).toMatchObject({ payment_intent: "pi_1", amount: 2500 });
    const data = updateContribution.mock.calls[0][0].data;
    expect(Number(data.refundedAmount)).toBe(25);
    expect(data.providerRefundId).toBe("re_1");
  });

  it("CONNECT-C §17: a connected-account contribution refunds against ITS OWN account, not the platform", async () => {
    findFirstContribution.mockResolvedValueOnce({
      ...PROVIDER_ROW,
      stripeConnectedAccountId: "acct_connected1",
      providerAccountContext: "CONNECTED_ACCOUNT_PAYMENT",
    });
    findUniqueStripeAccount.mockResolvedValueOnce({ accountMode: "test" });
    stripeRefundsCreateConnected.mockResolvedValueOnce({ id: "re_conn1", status: "succeeded", amount: 2500 });
    findFirstContribution.mockResolvedValueOnce({
      ...PROVIDER_ROW,
      stripeConnectedAccountId: "acct_connected1",
      providerAccountContext: "CONNECTED_ACCOUNT_PAYMENT",
    }); // applyProviderRefund lookup
    await issueRefund({ organizationId: "org-1", contributionId: "c-1", amount: 25, reason: "duplicate gift", actorUserId: "fin" });
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
    expect(stripeRefundsCreateConnected.mock.calls[0][0]).toMatchObject({ payment_intent: "pi_1", amount: 2500 });
    expect(stripeRefundsCreateConnected.mock.calls[0][1]).toEqual({ stripeAccount: "acct_connected1" });
    expect(findUniqueStripeAccount.mock.calls[0][0].where).toEqual({ stripeAccountId: "acct_connected1" });
  });

  it("a legacy (pre-Connect) platform-account row still refunds via the platform client, no stripeAccount option", async () => {
    findFirstContribution.mockResolvedValueOnce({ ...PROVIDER_ROW, stripeConnectedAccountId: null, providerAccountContext: null });
    stripeRefundsCreate.mockResolvedValueOnce({ id: "re_legacy1", status: "succeeded", amount: 2500 });
    findFirstContribution.mockResolvedValueOnce({ ...PROVIDER_ROW, stripeConnectedAccountId: null, providerAccountContext: null });
    await issueRefund({ organizationId: "org-1", contributionId: "c-1", amount: 25, reason: "duplicate gift", actorUserId: "fin" });
    expect(stripeRefundsCreateConnected).not.toHaveBeenCalled();
    expect(stripeRefundsCreate.mock.calls[0][1]).toBeUndefined();
  });

  it("a pending provider refund does NOT mark the row — the webhook will", async () => {
    findFirstContribution.mockResolvedValueOnce(PROVIDER_ROW);
    stripeRefundsCreate.mockResolvedValueOnce({ id: "re_2", status: "pending", amount: 10000 });
    const result = await issueRefund({ organizationId: "org-1", contributionId: "c-1", reason: "requested", actorUserId: "fin" });
    expect(result.marked).toBe(false);
    // Only the reason/actor context is stored — refundedAt stays unset.
    const data = updateContribution.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("refundedAt");
    expect(data.refundReason).toBe("requested");
  });
});

describe("applyProviderRefund idempotency and modes", () => {
  it("same provider refund id twice → DUPLICATE, no second write", async () => {
    findFirstContribution.mockResolvedValueOnce({ ...PROVIDER_ROW, providerRefundId: "re_1", refundedAt: new Date() });
    const result = await applyProviderRefund({
      organizationId: "org-1",
      providerPaymentIntentId: "pi_1",
      providerRefundId: "re_1",
      amountRefundedCents: 2500,
    });
    expect(result).toBe("DUPLICATE");
    expect(updateContribution).not.toHaveBeenCalled();
  });

  it("cumulative mode uses the provider running total — no double counting", async () => {
    findFirstContribution.mockResolvedValueOnce({ ...PROVIDER_ROW, refundedAmount: 25 });
    await applyProviderRefund({
      organizationId: "org-1",
      providerPaymentIntentId: "pi_1",
      providerRefundId: "re_3",
      amountRefundedCents: 2500, // Stripe's cumulative total — already applied
      mode: "cumulative",
    });
    expect(Number(updateContribution.mock.calls[0][0].data.refundedAmount)).toBe(25);
  });

  it("increment mode adds and caps at the original amount", async () => {
    findFirstContribution.mockResolvedValueOnce({ ...PROVIDER_ROW, refundedAmount: 90 });
    await applyProviderRefund({
      organizationId: "org-1",
      providerPaymentIntentId: "pi_1",
      providerRefundId: "re_4",
      amountRefundedCents: 2000,
    });
    expect(Number(updateContribution.mock.calls[0][0].data.refundedAmount)).toBe(100);
  });
});

describe("controlled adjustments (§100)", () => {
  it("cross-org contribution → 404; closed destination fund → 409; same fund → 409", async () => {
    findFirstContribution.mockResolvedValueOnce(null);
    await expect(
      adjustContribution({ organizationId: "org-1", contributionId: "c-x", kind: "FUND_RECLASSIFICATION", newFundId: "f-2", reason: "r", actorUserId: "fin" })
    ).rejects.toMatchObject({ status: 404 });

    findFirstContribution.mockResolvedValueOnce(PROVIDER_ROW);
    findFirstFund.mockResolvedValueOnce({ id: "f-2", name: "Closed", status: "CLOSED" });
    await expect(
      adjustContribution({ organizationId: "org-1", contributionId: "c-1", kind: "FUND_RECLASSIFICATION", newFundId: "f-2", reason: "r", actorUserId: "fin" })
    ).rejects.toMatchObject({ status: 409 });

    findFirstContribution.mockResolvedValueOnce(PROVIDER_ROW);
    findFirstFund.mockResolvedValueOnce({ id: "f-1", name: "Same", status: "ACTIVE" });
    await expect(
      adjustContribution({ organizationId: "org-1", contributionId: "c-1", kind: "FUND_RECLASSIFICATION", newFundId: "f-1", reason: "r", actorUserId: "fin" })
    ).rejects.toMatchObject({ status: 409 });
    expect(createAdjustment).not.toHaveBeenCalled();
  });

  it("fund reclassification stores before/after + reason and audits — amount untouched", async () => {
    findFirstContribution.mockResolvedValueOnce(PROVIDER_ROW);
    findFirstFund.mockResolvedValueOnce({ id: "f-2", name: "Youth Fund", status: "ACTIVE" });
    await adjustContribution({
      organizationId: "org-1",
      contributionId: "c-1",
      kind: "FUND_RECLASSIFICATION",
      newFundId: "f-2",
      reason: "entered against the wrong fund",
      actorUserId: "fin",
    });
    const adjustment = createAdjustment.mock.calls[0][0].data;
    expect(adjustment.before).toEqual({ fundId: "f-1" });
    expect(adjustment.after).toEqual({ fundId: "f-2" });
    const contributionUpdate = updateContribution.mock.calls[0][0].data;
    expect(contributionUpdate).not.toHaveProperty("amount");
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "giving.contribution_adjusted" }));
  });
});

describe("pledge credit subtracts refunds (§34.9)", () => {
  it("progress = sum(amount) − sum(refundedAmount), floored at zero", async () => {
    aggregateContributions
      .mockResolvedValueOnce({ _sum: { amount: 500 } })
      .mockResolvedValueOnce({ _sum: { refundedAmount: 120 } });
    await expect(pledgeProgress("org-1", "pl-1")).resolves.toBe(380);
  });
});

describe("telemetry sanitizer (§71) and CSV escaping (§53)", () => {
  it("drops non-allowlisted keys — emails and names never reach logs", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logGivingEvent("GIVING_PAYMENT_RECORDED", {
      organizationId: "org-1",
      amountCents: 500,
      guestEmail: "pat@example.com",
      guestName: "Pat",
    } as never);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line.organizationId).toBe("org-1");
    expect(line).not.toHaveProperty("guestEmail");
    expect(line).not.toHaveProperty("guestName");
    spy.mockRestore();
  });

  it("CSV escapes quotes, commas, and newlines", () => {
    const csv = reportToCsv({
      type: "summary",
      columns: ["Name", "Amount"],
      rows: [['Fund, "General"', 100]],
    });
    expect(csv).toBe('Name,Amount\n"Fund, ""General""",100');
  });
});
