import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveLockedOrFreshQuote = vi.fn();
vi.mock("../elections", () => ({ resolveLockedOrFreshQuote: (...a: unknown[]) => resolveLockedOrFreshQuote(...a) }));

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
const findManyPurchase = vi.fn();
const updateManyPurchase = vi.fn();
const findUniquePurchase = vi.fn();
const updatePurchase = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerBuyoutPurchase: {
      create: (...a: unknown[]) => createPurchase(...a),
      findFirst: (...a: unknown[]) => findFirstPurchase(...a),
      findMany: (...a: unknown[]) => findManyPurchase(...a),
      findUnique: (...a: unknown[]) => findUniquePurchase(...a),
      updateMany: (...a: unknown[]) => updateManyPurchase(...a),
      update: (...a: unknown[]) => updatePurchase(...a),
    },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

const stripeSessionsCreate = vi.fn();
const stripeSessionsRetrieve = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resolveConnectedAccountForCharges.mockResolvedValue({ stripeConnectedAccountId: "acct_123", accountMode: "test" });
  getStripeForMode.mockResolvedValue({
    checkout: {
      sessions: {
        create: (...a: unknown[]) => stripeSessionsCreate(...a),
        retrieve: (...a: unknown[]) => stripeSessionsRetrieve(...a),
      },
    },
  });
  resolveCoveragePlan.mockResolvedValue({ coverageCents: 0, totalCents: 12_000, coverageMode: "NONE", required: false, policyVersion: "v2.0" });
  createPendingPayment.mockResolvedValue({ id: "pending-1", idempotencyReference: "idem-1" });
  createPurchase.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "purchase-1", ...data }));
  stripeSessionsCreate.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" });
  stripeSessionsRetrieve.mockResolvedValue(null);
  updatePurchase.mockResolvedValue({});
  findFirstPurchase.mockResolvedValue(null);
  findManyPurchase.mockResolvedValue([]);
  // Deployment-gate review: default to a successful compare-and-swap. This
  // mock is now shared by TWO call sites within a single successful
  // checkout -- supersedePendingPurchases (short-circuits before ever
  // calling updateMany when findManyPurchase's own default, [], means
  // there's nothing to supersede) and the final providerSessionId-attach
  // guard (see purchases.ts's "attached.count === 0" comment) -- so the
  // happy-path default must reflect a successful ATTACH, not a "nothing to
  // supersede" no-op; tests that specifically exercise the supersede path
  // already override this value explicitly.
  updateManyPurchase.mockResolvedValue({ count: 1 });
});

describe("createVolunteerBuyoutCheckout", () => {
  it("rejects a VOLUNTEER election — nothing to check out", async () => {
    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    await expect(
      createVolunteerBuyoutCheckout("org-1", "period-1", "hh-1", { electionType: "VOLUNTEER" as never }, { userId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(resolveLockedOrFreshQuote).not.toHaveBeenCalled();
  });

  it("rejects a zero-cost quote", async () => {
    resolveLockedOrFreshQuote.mockResolvedValue({ electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 0, rateCents: 0, totalCents: 0, pricingWindowId: null });
    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    await expect(
      createVolunteerBuyoutCheckout("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT" }, { userId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("creates a PENDING purchase snapshotting the quote, then a Stripe session classified pta-volunteer-buyout (never a donation)", async () => {
    resolveLockedOrFreshQuote.mockResolvedValue({ electionType: "FULL_BUYOUT", hoursElectedMinutes: 1200, rateCents: 25_000, totalCents: 25_000, pricingWindowId: "window-1" });
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
    // RV-2: a deterministic idempotency key derived from the purchase row's own id.
    expect(stripeSessionsCreate.mock.calls[0][1]).toEqual({ stripeAccount: "acct_123", idempotencyKey: "pta-volunteer-buyout-checkout:purchase-1" });
  });

  it("FC-5: supersedes any other still-PENDING purchase for this household+period before creating a new one", async () => {
    resolveLockedOrFreshQuote.mockResolvedValue({ electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 480, rateCents: 1_500, totalCents: 12_000, pricingWindowId: "window-2" });
    findManyPurchase.mockResolvedValue([{ id: "old-pending-1" }, { id: "old-pending-2" }]);
    updateManyPurchase.mockResolvedValue({ count: 2 });

    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    await createVolunteerBuyoutCheckout("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT" }, { userId: "u1" });

    expect(findManyPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1", requirementPeriodId: "period-1", householdId: "hh-1", status: "PENDING" }) })
    );
    expect(updateManyPurchase).toHaveBeenCalledWith({
      where: { id: { in: ["old-pending-1", "old-pending-2"] }, status: "PENDING" },
      data: { status: "FAILED" },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.pending_purchase_superseded" }));
    // The supersede pass must run BEFORE the new purchase is created, never after.
    expect(updateManyPurchase.mock.invocationCallOrder[0]).toBeLessThan(createPurchase.mock.invocationCallOrder[0]);
  });

  it("FC-5: does nothing to supersede when there's no prior PENDING purchase", async () => {
    resolveLockedOrFreshQuote.mockResolvedValue({ electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 480, rateCents: 1_500, totalCents: 12_000, pricingWindowId: "window-2" });
    findManyPurchase.mockResolvedValue([]);

    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    await createVolunteerBuyoutCheckout("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT" }, { userId: "u1" });

    // updateMany IS called once (the deployment-gate-review attach guard —
    // see purchases.ts), but never with the SUPERSEDE shape, since there
    // was nothing to supersede.
    expect(updateManyPurchase).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
    expect(createAuditEvent).not.toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.pending_purchase_superseded" }));
  });

  it("never trusts a client-supplied amount — always re-derives via resolveLockedOrFreshQuote", async () => {
    resolveLockedOrFreshQuote.mockResolvedValue({ electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 480, rateCents: 1_500, totalCents: 12_000, pricingWindowId: "window-2" });
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

  it("RV-2: reuses a still-open PENDING purchase's existing Stripe session instead of creating a second one", async () => {
    resolveLockedOrFreshQuote.mockResolvedValue({ electionType: "FULL_BUYOUT", hoursElectedMinutes: 1200, rateCents: 25_000, totalCents: 25_000, pricingWindowId: "window-1" });
    findFirstPurchase.mockResolvedValue({ id: "existing-pending-1", providerSessionId: "cs_existing" });
    stripeSessionsRetrieve.mockResolvedValue({ status: "open", url: "https://checkout.stripe.com/cs_existing" });

    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    const result = await createVolunteerBuyoutCheckout("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT" }, { userId: "u1" });

    expect(result.url).toBe("https://checkout.stripe.com/cs_existing");
    expect(stripeSessionsRetrieve).toHaveBeenCalledWith("cs_existing", {}, { stripeAccount: "acct_123" });
    // Nothing new was created or superseded — this is a pure reuse.
    expect(createPurchase).not.toHaveBeenCalled();
    expect(updateManyPurchase).not.toHaveBeenCalled();
    expect(stripeSessionsCreate).not.toHaveBeenCalled();
  });

  it("RV-2: falls through to supersede+create when the existing PENDING purchase's session has expired", async () => {
    resolveLockedOrFreshQuote.mockResolvedValue({ electionType: "FULL_BUYOUT", hoursElectedMinutes: 1200, rateCents: 25_000, totalCents: 25_000, pricingWindowId: "window-1" });
    findFirstPurchase.mockResolvedValue({ id: "existing-pending-1", providerSessionId: "cs_stale" });
    stripeSessionsRetrieve.mockResolvedValue({ status: "expired", url: null });
    findManyPurchase.mockResolvedValue([{ id: "existing-pending-1" }]);
    updateManyPurchase.mockResolvedValue({ count: 1 });

    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    const result = await createVolunteerBuyoutCheckout("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT" }, { userId: "u1" });

    expect(result.url).toBe("https://checkout.stripe.com/cs_test_1");
    expect(updateManyPurchase).toHaveBeenCalledWith({ where: { id: { in: ["existing-pending-1"] }, status: "PENDING" }, data: { status: "FAILED" } });
    expect(createPurchase).toHaveBeenCalled();
  });

  it("RV-2: falls through to supersede+create when the existing PENDING purchase never reached Stripe (no session id yet)", async () => {
    resolveLockedOrFreshQuote.mockResolvedValue({ electionType: "FULL_BUYOUT", hoursElectedMinutes: 1200, rateCents: 25_000, totalCents: 25_000, pricingWindowId: "window-1" });
    findFirstPurchase.mockResolvedValue({ id: "existing-pending-1", providerSessionId: null });

    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    const result = await createVolunteerBuyoutCheckout("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT" }, { userId: "u1" });

    expect(result.url).toBe("https://checkout.stripe.com/cs_test_1");
    expect(stripeSessionsRetrieve).not.toHaveBeenCalled();
    expect(createPurchase).toHaveBeenCalled();
  });

  it("RV-2: a lost race on the partial unique index reuses the winner's already-open session rather than throwing", async () => {
    resolveLockedOrFreshQuote.mockResolvedValue({ electionType: "FULL_BUYOUT", hoursElectedMinutes: 1200, rateCents: 25_000, totalCents: 25_000, pricingWindowId: "window-1" });
    const { Prisma } = await import("@prisma/client");
    const duplicatePendingError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: "PtaVolunteerBuyoutPurchase_org_period_household_pending" },
    });
    createPurchase.mockRejectedValueOnce(duplicatePendingError);
    // First findFirst (pre-create reuse check) finds nothing; second (post-P2002 refetch) finds the winner.
    findFirstPurchase.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "winner-pending-1", providerSessionId: "cs_winner" });
    stripeSessionsRetrieve.mockResolvedValue({ status: "open", url: "https://checkout.stripe.com/cs_winner" });

    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    const result = await createVolunteerBuyoutCheckout("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT" }, { userId: "u1" });

    expect(result.url).toBe("https://checkout.stripe.com/cs_winner");
    expect(stripeSessionsCreate).not.toHaveBeenCalled();
  });

  it("RV-2: a lost race whose winner hasn't reached Stripe yet surfaces a retryable in-progress error, never a duplicate", async () => {
    resolveLockedOrFreshQuote.mockResolvedValue({ electionType: "FULL_BUYOUT", hoursElectedMinutes: 1200, rateCents: 25_000, totalCents: 25_000, pricingWindowId: "window-1" });
    const { Prisma } = await import("@prisma/client");
    const duplicatePendingError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["organizationId", "requirementPeriodId", "householdId"] },
    });
    createPurchase.mockRejectedValueOnce(duplicatePendingError);
    findFirstPurchase.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "winner-pending-1", providerSessionId: null });

    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    await expect(
      createVolunteerBuyoutCheckout("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT" }, { userId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_CHECKOUT_IN_PROGRESS" });
    expect(stripeSessionsCreate).not.toHaveBeenCalled();
  });

  it("deployment-gate review: if the purchase row is superseded while this call is still awaiting Stripe, the attach is refused (guarded compare-and-swap) rather than silently re-attaching a live session URL to a now-FAILED row", async () => {
    resolveLockedOrFreshQuote.mockResolvedValue({ electionType: "FULL_BUYOUT", hoursElectedMinutes: 1200, rateCents: 25_000, totalCents: 25_000, pricingWindowId: "window-1" });
    // The attach step's own updateMany call reports it matched zero rows --
    // i.e., some other request superseded this purchase (marked it FAILED)
    // in the window between this call's create() and its own attach.
    updateManyPurchase.mockResolvedValue({ count: 0 });

    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    await expect(
      createVolunteerBuyoutCheckout("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT" }, { userId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_CHECKOUT_IN_PROGRESS" });

    // The purchase row itself was created (a real Stripe session was created
    // for it too, harmlessly orphaned) -- what must NEVER happen is handing
    // that URL back to the caller as if it were live.
    expect(createPurchase).toHaveBeenCalled();
    expect(stripeSessionsCreate).toHaveBeenCalled();
  });

  it("RV-2: a P2002 on an unrelated constraint is rethrown, not swallowed as a checkout race", async () => {
    resolveLockedOrFreshQuote.mockResolvedValue({ electionType: "FULL_BUYOUT", hoursElectedMinutes: 1200, rateCents: 25_000, totalCents: 25_000, pricingWindowId: "window-1" });
    const { Prisma } = await import("@prisma/client");
    const unrelatedError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["someOtherColumn"] },
    });
    createPurchase.mockRejectedValueOnce(unrelatedError);

    const { createVolunteerBuyoutCheckout } = await import("../purchases");
    await expect(createVolunteerBuyoutCheckout("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT" }, { userId: "u1" })).rejects.toBe(
      unrelatedError
    );
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
    // RV-7: settlement never re-derives a price -- it only compares Stripe's
    // reported amount against the ALREADY-FROZEN purchase.totalCents. If a
    // webhook arrives after the originating election lock or pricing window
    // has since expired/closed, that expiration has zero bearing here: the
    // charge always matches what was frozen before checkout, never what the
    // election/window state happens to be at settle time.
    expect(resolveLockedOrFreshQuote).not.toHaveBeenCalled();
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
    resolveLockedOrFreshQuote.mockResolvedValue({ electionType: "FULL_BUYOUT", hoursElectedMinutes: 1200, rateCents: 25_000, totalCents: 25_000, pricingWindowId: "window-1" });
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

  it("FC-5: supersedes a still-open Stripe PENDING purchase before recording a paid-by-check completion — an old abandoned session can never double-credit after this", async () => {
    resolveLockedOrFreshQuote.mockResolvedValue({ electionType: "FULL_BUYOUT", hoursElectedMinutes: 1200, rateCents: 25_000, totalCents: 25_000, pricingWindowId: "window-1" });
    findManyPurchase.mockResolvedValue([{ id: "stale-stripe-pending" }]);
    updateManyPurchase.mockResolvedValue({ count: 1 });

    const { recordOfflineVolunteerBuyoutPurchase } = await import("../purchases");
    await recordOfflineVolunteerBuyoutPurchase(
      "org-1",
      "period-1",
      "hh-1",
      { electionType: "FULL_BUYOUT", paymentMethod: "CHECK", reference: "check #4521" },
      { userId: "officer-1", userEmail: "officer@example.com" }
    );

    expect(updateManyPurchase).toHaveBeenCalledWith({ where: { id: { in: ["stale-stripe-pending"] }, status: "PENDING" }, data: { status: "FAILED" } });
  });
});
