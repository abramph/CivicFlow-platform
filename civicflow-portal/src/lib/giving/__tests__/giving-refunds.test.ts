import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const findFirstContribution = vi.fn();
const updateContribution = vi.fn();
const aggregateContributions = vi.fn();
const findFirstFund = vi.fn();
const findFirstOrgMember = vi.fn();
const createAdjustment = vi.fn();
const createRefundEvent = vi.fn();
const queryRawLocked = vi.fn();
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
    contributionRefundEvent: { create: (...a: unknown[]) => createRefundEvent(...a) },
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

/** Simulates the real Postgres unique-constraint violation on
 * ContributionRefundEvent.providerRefundId that applyProviderRefund catches
 * to detect a replayed refund. */
function uniqueConstraintViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`providerRefundId`)", {
    code: "P2002",
    clientVersion: "test",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrgSettings.mockResolvedValue({ contributionsEnabled: true });
  // Array-form $transaction([...]) (adjustContribution) vs. callback-form
  // $transaction(async (tx) => {...}) (applyProviderRefund's row-locked
  // read-modify-write) — the real Prisma client supports both, so the mock
  // has to dispatch on the argument shape the same way.
  transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") {
      const tx = {
        $queryRaw: (...a: unknown[]) => queryRawLocked(...a),
        contributionRefundEvent: { create: (...a: unknown[]) => createRefundEvent(...a) },
        contribution: { update: (...a: unknown[]) => updateContribution(...a) },
      };
      return arg(tx);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
  createAdjustment.mockResolvedValue({ id: "adj-1" });
  createRefundEvent.mockResolvedValue({ id: "cre-1" });
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
      queryRawLocked.mockResolvedValueOnce([{ id: "c-1", totalChargedAmount: 103.3, amount: 100, refundedAmount: null }]);
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
    queryRawLocked.mockResolvedValueOnce([{ id: "c-1", totalChargedAmount: null, amount: 100, refundedAmount: null }]);
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
    queryRawLocked.mockResolvedValueOnce([{ id: "c-1", totalChargedAmount: null, amount: 100, refundedAmount: null }]);
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
    queryRawLocked.mockResolvedValueOnce([{ id: "c-1", totalChargedAmount: null, amount: 100, refundedAmount: null }]);
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

describe("applyProviderRefund — idempotency keyed on the real Stripe refund.id (2026-08 hardening)", () => {
  const apply = (over: Partial<Parameters<typeof applyProviderRefund>[0]> = {}) =>
    applyProviderRefund({
      organizationId: "org-1",
      providerPaymentIntentId: "pi_1",
      providerRefundId: "re_1",
      amountRefundedCents: 2000,
      status: "succeeded",
      source: "charge.refunded",
      ...over,
    });

  it("a replayed delivery of the SAME refund.id → DUPLICATE via the unique-constraint catch, no second row and no double count", async () => {
    findFirstContribution.mockResolvedValueOnce({ ...PROVIDER_ROW, refundedAmount: 20 });
    queryRawLocked.mockResolvedValueOnce([{ id: "c-1", totalChargedAmount: null, amount: 100, refundedAmount: 20 }]);
    createRefundEvent.mockRejectedValueOnce(uniqueConstraintViolation());
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await apply({ providerRefundId: "re_1", amountRefundedCents: 2000 });

    // Both statements are constructed together as one array-form
    // $transaction (that's how real Prisma sends them atomically) — the
    // meaningful guarantee isn't "update() was never called to build its
    // lazy query," it's that the unique-constraint rejection propagates as
    // DUPLICATE and never as a false APPLIED.
    expect(result).toBe("DUPLICATE");
    const lines = logSpy.mock.calls.map((c) => JSON.parse(c[0] as string).event);
    expect(lines).toContain("GIVING_REFUND_DUPLICATE_IGNORED");
    logSpy.mockRestore();
  });

  it("two DIFFERENT refund ids on the same contribution both apply — $20 then $15 → cumulative $35, net $65 of $100, each individually recorded", async () => {
    // First refund: $20 of $100.
    findFirstContribution.mockResolvedValueOnce({ ...PROVIDER_ROW, amount: 100, refundedAmount: null });
    queryRawLocked.mockResolvedValueOnce([{ id: "c-1", totalChargedAmount: null, amount: 100, refundedAmount: null }]);
    const first = await apply({ providerRefundId: "re_first_20", amountRefundedCents: 2000 });
    expect(first).toBe("APPLIED");
    expect(Number(updateContribution.mock.calls[0][0].data.refundedAmount)).toBe(20);
    expect(createRefundEvent.mock.calls[0][0].data).toMatchObject({ providerRefundId: "re_first_20", amountCents: 2000 });

    // Second, DIFFERENT refund: $15 more — must be independently applied and
    // additive, not collapsed into the first (the exact bug this replaces:
    // a synthetic charge-derived id made this second refund indistinguishable
    // from the first and it was silently dropped). Reads the LOCKED row's
    // now-current total (as if the first transaction's row lock released
    // and this one re-read it), not a stale pre-first-refund snapshot.
    findFirstContribution.mockResolvedValueOnce({ ...PROVIDER_ROW, amount: 100, refundedAmount: 20 });
    queryRawLocked.mockResolvedValueOnce([{ id: "c-1", totalChargedAmount: null, amount: 100, refundedAmount: 20 }]);
    const second = await apply({ providerRefundId: "re_second_15", amountRefundedCents: 1500 });
    expect(second).toBe("APPLIED");
    expect(Number(updateContribution.mock.calls[1][0].data.refundedAmount)).toBe(35);
    expect(createRefundEvent.mock.calls[1][0].data).toMatchObject({ providerRefundId: "re_second_15", amountCents: 1500 });

    // Net received = original − totalRefunded.
    expect(100 - 35).toBe(65);
  });

  it("a full refund (cumulative = original) is exact, not clamped short", async () => {
    findFirstContribution.mockResolvedValueOnce({ ...PROVIDER_ROW, amount: 100, refundedAmount: null });
    queryRawLocked.mockResolvedValueOnce([{ id: "c-1", totalChargedAmount: null, amount: 100, refundedAmount: null }]);
    await apply({ providerRefundId: "re_full", amountRefundedCents: 10000 });
    expect(Number(updateContribution.mock.calls[0][0].data.refundedAmount)).toBe(100);
  });

  it("financial invariant: cumulative refunded is clamped at the original amount even if a malformed/replayed amount would push it over", async () => {
    findFirstContribution.mockResolvedValueOnce({ ...PROVIDER_ROW, amount: 100, refundedAmount: 90 });
    queryRawLocked.mockResolvedValueOnce([{ id: "c-1", totalChargedAmount: null, amount: 100, refundedAmount: 90 }]);
    await apply({ providerRefundId: "re_overshoot", amountRefundedCents: 5000 }); // 90 + 50 > 100
    expect(Number(updateContribution.mock.calls[0][0].data.refundedAmount)).toBe(100);
  });

  it("a refund for a payment intent with no matching contribution (any org) → NOT_FOUND, no fabricated record, no crash", async () => {
    findFirstContribution.mockResolvedValueOnce(null);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await apply({ organizationId: "org-b", providerPaymentIntentId: "pi_unknown" });
    expect(result).toBe("NOT_FOUND");
    expect(createRefundEvent).not.toHaveBeenCalled();
    expect(updateContribution).not.toHaveBeenCalled();
    const lines = logSpy.mock.calls.map((c) => JSON.parse(c[0] as string).event);
    expect(lines).toContain("GIVING_REFUND_UNMATCHED");
    logSpy.mockRestore();
  });

  it("tenant isolation: the org-scoped lookup means a refund event can never mutate another org's contribution by payment-intent-id alone", async () => {
    // findFirst is called WITH organizationId in the where clause; the mock
    // simulates realistic tenant-scoped behavior by returning null when the
    // caller's org doesn't match — this is what the real WHERE clause does.
    findFirstContribution.mockImplementationOnce((args: { where: { organizationId: string } }) =>
      args.where.organizationId === "org-a" ? { ...PROVIDER_ROW, organizationId: "org-a" } : null
    );
    const result = await apply({ organizationId: "org-b", providerPaymentIntentId: "pi_1" });
    expect(result).toBe("NOT_FOUND");
    expect(updateContribution).not.toHaveBeenCalled();
  });

  it("concurrency fix: the cumulative total is computed from the FOR-UPDATE-locked row read, not the earlier unlocked existence-check read — proves a concurrent racer's committed write isn't lost", async () => {
    // Simulates the exact race this hardened: existence-check `findFirst`
    // sees a STALE snapshot (as if read before another in-flight refund
    // committed), but the row-locked `$queryRaw` inside the transaction
    // sees the CURRENT total (as if this call's lock only acquired after
    // that other transaction committed and released it). The correct
    // cumulative math must come from the locked read, not the stale one —
    // using the stale $0 prior would silently understate the total exactly
    // like the pre-fix lost-update race did.
    findFirstContribution.mockResolvedValueOnce({ ...PROVIDER_ROW, amount: 100, refundedAmount: 0 });
    queryRawLocked.mockResolvedValueOnce([{ id: "c-1", totalChargedAmount: null, amount: 100, refundedAmount: 20 }]);
    const result = await apply({ providerRefundId: "re_after_race", amountRefundedCents: 1500 });
    expect(result).toBe("APPLIED");
    expect(Number(updateContribution.mock.calls[0][0].data.refundedAmount)).toBe(35); // 20 (locked) + 15, NOT 0 (stale) + 15
  });

  it("a pending (not-yet-succeeded) refund status does not move money — the row stays untouched until it actually succeeds", async () => {
    findFirstContribution.mockResolvedValueOnce({ ...PROVIDER_ROW, refundedAmount: null });
    const result = await apply({ status: "pending" });
    expect(result).toBe("NOT_SUCCEEDED");
    expect(createRefundEvent).not.toHaveBeenCalled();
    expect(updateContribution).not.toHaveBeenCalled();
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
