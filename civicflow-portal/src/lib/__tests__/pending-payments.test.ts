import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const update = vi.fn();
const updateMany = vi.fn();
const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    pendingPayment: {
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
    },
  },
}));

import { createPendingPayment, settlePendingPaymentBySession } from "@/lib/payments/pending-payments";

const BASE_INPUT = {
  organizationId: "org-1",
  paymentPurpose: "member-dues",
  paymentNature: "FIXED_OBLIGATION" as const,
  obligationCents: 1000,
  processingCostCents: 61,
  coverageMode: "V2_REQUIRED",
  coverageRequired: true,
  stripeConnectedAccountId: "acct_1",
};

describe("createPendingPayment (COST-POLICY §7/§12 invariants)", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "pp-1", ...data }));
  });

  it("totalCents = obligationCents + processingCostCents, always", async () => {
    const row = await createPendingPayment(BASE_INPUT);
    expect(row.totalCents).toBe(1061);
    expect(create.mock.calls[0][0].data.totalCents).toBe(1061);
  });

  it("negative fees and impossible allocations never reach the database", async () => {
    await expect(createPendingPayment({ ...BASE_INPUT, processingCostCents: -1 })).rejects.toThrow(/non-negative/);
    await expect(createPendingPayment({ ...BASE_INPUT, obligationCents: 0 })).rejects.toThrow(/positive/);
    await expect(createPendingPayment({ ...BASE_INPUT, obligationCents: 10.5 })).rejects.toThrow(/integer/);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("settlePendingPaymentBySession (COST-POLICY §10)", () => {
  const RECORD = {
    id: "pp-1",
    status: "PENDING",
    totalCents: 1061,
    stripeConnectedAccountId: "acct_1",
    mismatchReason: null,
  };

  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    updateMany.mockReset();
  });

  it("legacy sessions without a pending record proceed as NOT_FOUND", async () => {
    findUnique.mockResolvedValueOnce(null);
    const result = await settlePendingPaymentBySession({
      stripeSessionId: "cs_1",
      paidTotalCents: 1061,
      stripeConnectedAccountId: "acct_1",
    });
    expect(result.outcome).toBe("NOT_FOUND");
  });

  it("a matching paid total settles exactly once", async () => {
    findUnique.mockResolvedValueOnce(RECORD).mockResolvedValueOnce({ ...RECORD, status: "COMPLETED" });
    updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await settlePendingPaymentBySession({
      stripeSessionId: "cs_1",
      paidTotalCents: 1061,
      stripeConnectedAccountId: "acct_1",
    });
    expect(result.outcome).toBe("SETTLED");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "pp-1", status: "PENDING" },
      data: expect.objectContaining({ status: "COMPLETED" }),
    });
  });

  it("a paid total that differs from the authorized total is a MISMATCH — the caller records nothing", async () => {
    findUnique.mockResolvedValueOnce(RECORD);
    update.mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({ ...RECORD, ...data }));

    const result = await settlePendingPaymentBySession({
      stripeSessionId: "cs_1",
      paidTotalCents: 999, // tampered / stale
      stripeConnectedAccountId: "acct_1",
    });
    expect(result.outcome).toBe("MISMATCH");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "MISMATCHED" }) })
    );
  });

  it("a different connected account is a MISMATCH even when the total matches", async () => {
    findUnique.mockResolvedValueOnce(RECORD);
    update.mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({ ...RECORD, ...data }));

    const result = await settlePendingPaymentBySession({
      stripeSessionId: "cs_1",
      paidTotalCents: 1061,
      stripeConnectedAccountId: "acct_EVIL",
    });
    expect(result.outcome).toBe("MISMATCH");
  });

  it("webhook replay: an already-completed record reports ALREADY_COMPLETED and never settles twice", async () => {
    findUnique.mockResolvedValueOnce({ ...RECORD, status: "COMPLETED" });
    const result = await settlePendingPaymentBySession({
      stripeSessionId: "cs_1",
      paidTotalCents: 1061,
      stripeConnectedAccountId: "acct_1",
    });
    expect(result.outcome).toBe("ALREADY_COMPLETED");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("losing the settle race resolves as the replay it is", async () => {
    findUnique
      .mockResolvedValueOnce(RECORD)
      .mockResolvedValueOnce({ ...RECORD, status: "COMPLETED" });
    updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await settlePendingPaymentBySession({
      stripeSessionId: "cs_1",
      paidTotalCents: 1061,
      stripeConnectedAccountId: "acct_1",
    });
    expect(result.outcome).toBe("ALREADY_COMPLETED");
  });
});
