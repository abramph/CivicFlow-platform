import { beforeEach, describe, expect, it, vi } from "vitest";

const buildBuyoutQuote = vi.fn();
vi.mock("../elections", () => ({ buildBuyoutQuote: (...a: unknown[]) => buildBuyoutQuote(...a) }));

const postLedgerEntry = vi.fn().mockResolvedValue({ id: "ledger-1" });
vi.mock("../ledger", () => ({ postLedgerEntry: (...a: unknown[]) => postLedgerEntry(...a) }));

const resolveConnectedAccountForCharges = vi.fn();
const getStripeForMode = vi.fn();
vi.mock("@/lib/payments/stripe-connect", () => ({
  resolveConnectedAccountForCharges: (...a: unknown[]) => resolveConnectedAccountForCharges(...a),
  getStripeForMode: (...a: unknown[]) => getStripeForMode(...a),
}));

const derivePaymentNature = vi.fn().mockReturnValue("VOLUNTARY");
const resolveCoveragePlan = vi.fn();
vi.mock("@/lib/payments/cost-policy", () => ({
  derivePaymentNature: (...a: unknown[]) => derivePaymentNature(...a),
  resolveCoveragePlan: (...a: unknown[]) => resolveCoveragePlan(...a),
}));

const createPendingPayment = vi.fn();
const attachStripeSession = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/payments/pending-payments", () => ({
  createPendingPayment: (...a: unknown[]) => createPendingPayment(...a),
  attachStripeSession: (...a: unknown[]) => attachStripeSession(...a),
}));

vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ NEXTAUTH_URL: "https://app.example.com" }) }));

const createPurchase = vi.fn();
const findFirstPurchase = vi.fn();
const updateManyPurchase = vi.fn();
const findUniquePurchase = vi.fn();
const updatePurchase = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerBuyoutPurchase: {
      create: (...a: unknown[]) => createPurchase(...a),
      findFirst: (...a: unknown[]) => findFirstPurchase(...a),
      findUnique: (...a: unknown[]) => findUniquePurchase(...a),
      updateMany: (...a: unknown[]) => updateManyPurchase(...a),
      update: (...a: unknown[]) => updatePurchase(...a),
    },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

const stripeSessionsCreate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resolveConnectedAccountForCharges.mockResolvedValue({ stripeConnectedAccountId: "acct_123", accountMode: "test" });
  getStripeForMode.mockResolvedValue({ checkout: { sessions: { create: (...a: unknown[]) => stripeSessionsCreate(...a) } } });
  resolveCoveragePlan.mockResolvedValue({ coverageCents: 0, totalCents: 12_000, coverageMode: "NONE", required: false, policyVersion: "v2.0" });
  createPendingPayment.mockResolvedValue({ id: "pending-1", idempotencyReference: "idem-1" });
  createPurchase.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "purchase-1", ...data }));
  stripeSessionsCreate.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" });
  updatePurchase.mockResolvedValue({});
});

describe("createVolunteerBuyoutCheckout", () => {
  it("rejects a VOLUNTEER election — nothing to check out", async () => {
    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    await expect(
      createVolunteerBuyoutCheckout("org-1", "period-1", "hh-1", { electionType: "VOLUNTEER" as never }, { userId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(buildBuyoutQuote).not.toHaveBeenCalled();
  });

  it("rejects a zero-cost quote", async () => {
    buildBuyoutQuote.mockResolvedValue({ electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 0, rateCents: 0, totalCents: 0, pricingWindowId: null });
    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    await expect(
      createVolunteerBuyoutCheckout("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT" }, { userId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("creates a PENDING purchase snapshotting the quote, then a Stripe session classified pta-volunteer-buyout (never a donation)", async () => {
    buildBuyoutQuote.mockResolvedValue({ electionType: "FULL_BUYOUT", hoursElectedMinutes: 1200, rateCents: 25_000, totalCents: 25_000, pricingWindowId: "window-1" });
    resolveCoveragePlan.mockResolvedValue({ coverageCents: 0, totalCents: 25_000, coverageMode: "NONE", required: false, policyVersion: "v2.0" });

    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    const result = await createVolunteerBuyoutCheckout("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT" }, { userId: "u1" });

    expect(result.url).toBe("https://checkout.stripe.com/cs_test_1");
    expect(createPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          paymentMethod: "STRIPE",
          hoursElectedMinutes: 1200,
          baseAmountCents: 25_000,
          rateType: "FULL_BUYOUT",
        }),
      })
    );
    const sessionArg = stripeSessionsCreate.mock.calls[0][0];
    expect(sessionArg.metadata.paymentType).toBe("pta-volunteer-buyout");
    expect(sessionArg.line_items[0].price_data.unit_amount).toBe(25_000);
    // The Stripe session is created on the ORG's connected account, never the platform's.
    expect(stripeSessionsCreate.mock.calls[0][1]).toEqual({ stripeAccount: "acct_123" });
  });

  it("never trusts a client-supplied amount — always re-derives from buildBuyoutQuote", async () => {
    buildBuyoutQuote.mockResolvedValue({ electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 480, rateCents: 1_500, totalCents: 12_000, pricingWindowId: "window-2" });
    resolveCoveragePlan.mockResolvedValue({ coverageCents: 0, totalCents: 12_000, coverageMode: "NONE", required: false, policyVersion: "v2.0" });
    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    await createVolunteerBuyoutCheckout(
      "org-1",
      "period-1",
      "hh-1",
      // A hostile client field that isn't even a real quote input.
      { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 480, totalCents: 1 } as never,
      { userId: "u1" }
    );
    expect(resolveCoveragePlan).toHaveBeenCalledWith(expect.objectContaining({ baseCents: 12_000 }));
  });
});

describe("recordVolunteerBuyoutPurchase — webhook idempotency", () => {
  const purchase = {
    id: "purchase-1",
    organizationId: "org-1",
    requirementPeriodId: "period-1",
    householdId: "hh-1",
    status: "PENDING",
    totalCents: 12_000,
    baseAmountCents: 12_000,
    coverageAmountCents: 0,
    hoursElectedMinutes: 480,
    electionType: "PARTIAL_BUYOUT",
    stripeConnectedAccountId: "acct_123",
  };

  it("rejects when the purchase isn't found in this organization", async () => {
    findFirstPurchase.mockResolvedValue(null);
    const { recordVolunteerBuyoutPurchase } = await import("../purchases");
    const result = await recordVolunteerBuyoutPurchase({
      organizationId: "org-1",
      purchaseId: "nope",
      amountTotalCents: 12_000,
      stripeConnectedAccountId: "acct_123",
      providerPaymentIntentId: "pi_1",
      providerSessionId: "cs_1",
    });
    expect(result).toEqual({ outcome: "REJECTED", reason: "purchase not found in this organization" });
    expect(postLedgerEntry).not.toHaveBeenCalled();
  });

  it("returns ALREADY_RECORDED without posting again when already COMPLETED — webhook replay safety", async () => {
    findFirstPurchase.mockResolvedValue({ ...purchase, status: "COMPLETED" });
    const { recordVolunteerBuyoutPurchase } = await import("../purchases");
    const result = await recordVolunteerBuyoutPurchase({
      organizationId: "org-1",
      purchaseId: "purchase-1",
      amountTotalCents: 12_000,
      stripeConnectedAccountId: "acct_123",
      providerPaymentIntentId: "pi_1",
      providerSessionId: "cs_1",
    });
    expect(result).toEqual({ outcome: "ALREADY_RECORDED" });
    expect(postLedgerEntry).not.toHaveBeenCalled();
  });

  it("rejects and records nothing on an amount mismatch", async () => {
    findFirstPurchase.mockResolvedValue(purchase);
    const { recordVolunteerBuyoutPurchase } = await import("../purchases");
    const result = await recordVolunteerBuyoutPurchase({
      organizationId: "org-1",
      purchaseId: "purchase-1",
      amountTotalCents: 999,
      stripeConnectedAccountId: "acct_123",
      providerPaymentIntentId: "pi_1",
      providerSessionId: "cs_1",
    });
    expect(result.outcome).toBe("REJECTED");
    expect(updateManyPurchase).not.toHaveBeenCalled();
    expect(postLedgerEntry).not.toHaveBeenCalled();
  });

  it("rejects on a connected-account mismatch", async () => {
    findFirstPurchase.mockResolvedValue(purchase);
    const { recordVolunteerBuyoutPurchase } = await import("../purchases");
    const result = await recordVolunteerBuyoutPurchase({
      organizationId: "org-1",
      purchaseId: "purchase-1",
      amountTotalCents: 12_000,
      stripeConnectedAccountId: "acct_DIFFERENT",
      providerPaymentIntentId: "pi_1",
      providerSessionId: "cs_1",
    });
    expect(result.outcome).toBe("REJECTED");
    expect(postLedgerEntry).not.toHaveBeenCalled();
  });

  it("acceptance scenario (buyout): 8h @ $15/hr = $120 posts a PURCHASE ledger entry for exactly 480 minutes / 12000 cents", async () => {
    findFirstPurchase.mockResolvedValue(purchase);
    updateManyPurchase.mockResolvedValue({ count: 1 });
    const { recordVolunteerBuyoutPurchase } = await import("../purchases");
    const result = await recordVolunteerBuyoutPurchase({
      organizationId: "org-1",
      purchaseId: "purchase-1",
      amountTotalCents: 12_000,
      stripeConnectedAccountId: "acct_123",
      providerPaymentIntentId: "pi_1",
      providerSessionId: "cs_1",
    });
    expect(result).toEqual({ outcome: "RECORDED" });
    expect(postLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({ entryType: "PURCHASE", minutes: 480, amountCents: 12_000, sourceType: "buyoutPurchase", sourceId: "purchase-1" })
    );
    expect(postLedgerEntry).toHaveBeenCalledWith(expect.objectContaining({ entryType: "PAYMENT_ELECTRONIC", amountCents: 12_000 }));
  });

  it("loses the settle race gracefully — a concurrent webhook already completed it", async () => {
    findFirstPurchase.mockResolvedValue(purchase);
    updateManyPurchase.mockResolvedValue({ count: 0 });
    findUniquePurchase.mockResolvedValue({ ...purchase, status: "COMPLETED" });
    const { recordVolunteerBuyoutPurchase } = await import("../purchases");
    const result = await recordVolunteerBuyoutPurchase({
      organizationId: "org-1",
      purchaseId: "purchase-1",
      amountTotalCents: 12_000,
      stripeConnectedAccountId: "acct_123",
      providerPaymentIntentId: "pi_1",
      providerSessionId: "cs_1",
    });
    expect(result).toEqual({ outcome: "ALREADY_RECORDED" });
    expect(postLedgerEntry).not.toHaveBeenCalled();
  });
});

describe("recordOfflineVolunteerBuyoutPurchase", () => {
  it("re-quotes fresh, creates a COMPLETED purchase immediately, and posts both PURCHASE and PAYMENT_OFFLINE ledger entries", async () => {
    buildBuyoutQuote.mockResolvedValue({ electionType: "FULL_BUYOUT", hoursElectedMinutes: 1200, rateCents: 25_000, totalCents: 25_000, pricingWindowId: "window-1" });
    const { recordOfflineVolunteerBuyoutPurchase } = await import("../purchases");
    await recordOfflineVolunteerBuyoutPurchase(
      "org-1",
      "period-1",
      "hh-1",
      { electionType: "FULL_BUYOUT", paymentMethod: "CHECK", reference: "check #4521" },
      { userId: "officer-1", userEmail: "officer@example.com" }
    );

    expect(createPurchase).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED", paymentMethod: "CHECK" }) }));
    expect(postLedgerEntry).toHaveBeenCalledWith(expect.objectContaining({ entryType: "PURCHASE" }));
    expect(postLedgerEntry).toHaveBeenCalledWith(expect.objectContaining({ entryType: "PAYMENT_OFFLINE" }));
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.offline_purchase_recorded" }));
  });

  it("rejects a VOLUNTEER election type", async () => {
    const { recordOfflineVolunteerBuyoutPurchase } = await import("../purchases");
    await expect(
      recordOfflineVolunteerBuyoutPurchase("org-1", "period-1", "hh-1", { electionType: "VOLUNTEER" as never, paymentMethod: "CASH" }, { userId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });
});
