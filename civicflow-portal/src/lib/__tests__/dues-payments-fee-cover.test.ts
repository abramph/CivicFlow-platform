import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FEE-COVER-C: recordDuesPayment's `amount` is the BASE dues figure and is
 * the ONLY number that touches the member's DuesCharge obligation —
 * voluntary processing-cost coverage is stored alongside it but never
 * inflates what the member is credited as having paid toward dues (§20 of
 * the fee-cover program brief).
 */
const duesPaymentCreate = vi.fn();
const duesChargeUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        duesPayment: { create: (...args: unknown[]) => duesPaymentCreate(...args) },
        duesCharge: { update: (...args: unknown[]) => duesChargeUpdate(...args) },
      }),
  },
}));

import { recordDuesPayment } from "@/lib/dues-payments";

beforeEach(() => {
  vi.clearAllMocks();
  duesPaymentCreate.mockResolvedValue({ id: "dp-1" });
  duesChargeUpdate.mockResolvedValue({});
});

describe("recordDuesPayment — processing-cost coverage split", () => {
  it("writes the coverage split and settles the charge by the BASE amount only", async () => {
    await recordDuesPayment({
      organizationId: "org-1",
      memberId: "member-1",
      duesChargeId: "charge-1",
      amount: 50, // base
      paymentDate: new Date("2026-08-19"),
      method: "STRIPE",
      reference: "cs_test_x",
      stripeConnectedAccountId: "acct_1",
      providerAccountContext: "CONNECTED_ACCOUNT_PAYMENT",
      processingCostCoverageAmount: 1.87,
      totalChargedAmount: 51.87,
      charge: { id: "charge-1", amountPaid: 0, amountDue: 50 },
    });

    expect(duesPaymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 50,
        processingCostCoverageAmount: 1.87,
        totalChargedAmount: 51.87,
      }),
    });
    // Obligation settled by base (50), fully PAID — the $1.87 coverage never
    // appears in the charge balance math.
    expect(duesChargeUpdate).toHaveBeenCalledWith({
      where: { id: "charge-1" },
      data: { amountPaid: 50, status: "PAID" },
    });
  });

  it("a partial base payment with coverage still leaves the charge PARTIAL by base math alone", async () => {
    await recordDuesPayment({
      organizationId: "org-1",
      memberId: "member-1",
      duesChargeId: "charge-1",
      amount: 20,
      paymentDate: new Date("2026-08-19"),
      method: "STRIPE",
      processingCostCoverageAmount: 0.92,
      totalChargedAmount: 20.92,
      charge: { id: "charge-1", amountPaid: 0, amountDue: 50 },
    });

    expect(duesChargeUpdate).toHaveBeenCalledWith({
      where: { id: "charge-1" },
      data: { amountPaid: 20, status: "PARTIAL" },
    });
  });

  it("offline/manual rows leave both coverage fields null (never zero-filled)", async () => {
    await recordDuesPayment({
      organizationId: "org-1",
      memberId: "member-1",
      amount: 50,
      paymentDate: new Date("2026-08-19"),
      method: "CASH",
    });

    expect(duesPaymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        processingCostCoverageAmount: null,
        totalChargedAmount: null,
      }),
    });
  });
});
