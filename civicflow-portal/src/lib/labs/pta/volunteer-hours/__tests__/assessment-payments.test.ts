import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveConnectedAccountForCharges = vi.fn();
const getStripeForMode = vi.fn();
vi.mock("@/lib/payments/stripe-connect", () => ({
  resolveConnectedAccountForCharges: (...a: unknown[]) => resolveConnectedAccountForCharges(...a),
  getStripeForMode: (...a: unknown[]) => getStripeForMode(...a),
}));

const derivePaymentNature = vi.fn().mockReturnValue("FIXED_OBLIGATION");
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

const findFirstCharge = vi.fn();
const updateCharge = vi.fn();
const updateManyCharge = vi.fn();
const findUniqueCharge = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerAssessmentCharge: {
      findFirst: (...a: unknown[]) => findFirstCharge(...a),
      update: (...a: unknown[]) => updateCharge(...a),
      updateMany: (...a: unknown[]) => updateManyCharge(...a),
      findUnique: (...a: unknown[]) => findUniqueCharge(...a),
    },
  },
}));

const postLedgerEntry = vi.fn().mockResolvedValue({ id: "ledger-1" });
vi.mock("../ledger", () => ({ postLedgerEntry: (...a: unknown[]) => postLedgerEntry(...a) }));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

const stripeSessionsCreate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resolveConnectedAccountForCharges.mockResolvedValue({ stripeConnectedAccountId: "acct_123", accountMode: "test" });
  getStripeForMode.mockResolvedValue({ checkout: { sessions: { create: (...a: unknown[]) => stripeSessionsCreate(...a) } } });
  resolveCoveragePlan.mockResolvedValue({ coverageCents: 0, totalCents: 12_500, coverageMode: "NONE", required: false, policyVersion: "v2.0" });
  createPendingPayment.mockResolvedValue({ id: "pending-1", idempotencyReference: "idem-1" });
  stripeSessionsCreate.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/cs_test_1" });
  updateCharge.mockResolvedValue({});
});

const charge = {
  id: "charge-1",
  organizationId: "org-1",
  requirementPeriodId: "period-1",
  householdId: "hh-1",
  amountCents: 12_500,
  amountPaidCents: 0,
  status: "PENDING",
  stripeConnectedAccountId: "acct_123",
};

describe("createVolunteerAssessmentCheckout — tenant isolation", () => {
  it("only finds a charge scoped to the caller's OWN household — cross-household lookup returns not-found", async () => {
    findFirstCharge.mockResolvedValue(null);
    const { createVolunteerAssessmentCheckout } = await import("../assessment-payments");
    await expect(createVolunteerAssessmentCheckout("org-1", "charge-1", "hh-OTHER", { userId: "u1" })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
    expect(findFirstCharge).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "charge-1", organizationId: "org-1", householdId: "hh-OTHER" } }));
  });

  it("rejects an already-paid charge", async () => {
    findFirstCharge.mockResolvedValue({ ...charge, status: "PAID" });
    const { createVolunteerAssessmentCheckout } = await import("../assessment-payments");
    await expect(createVolunteerAssessmentCheckout("org-1", "charge-1", "hh-1", { userId: "u1" })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });

  it("creates a checkout session classified pta-volunteer-assessment for the outstanding balance", async () => {
    findFirstCharge.mockResolvedValue(charge);
    const { createVolunteerAssessmentCheckout } = await import("../assessment-payments");
    const result = await createVolunteerAssessmentCheckout("org-1", "charge-1", "hh-1", { userId: "u1" });
    expect(result.url).toBe("https://checkout.stripe.com/cs_test_1");
    expect(resolveCoveragePlan).toHaveBeenCalledWith(expect.objectContaining({ baseCents: 12_500, nature: "FIXED_OBLIGATION" }));
    expect(stripeSessionsCreate.mock.calls[0][0].metadata.paymentType).toBe("pta-volunteer-assessment");
  });
});

describe("recordVolunteerAssessmentPayment — webhook idempotency", () => {
  it("rejects on amount mismatch against the outstanding balance", async () => {
    findFirstCharge.mockResolvedValue(charge);
    const { recordVolunteerAssessmentPayment } = await import("../assessment-payments");
    const result = await recordVolunteerAssessmentPayment({
      organizationId: "org-1",
      chargeId: "charge-1",
      amountTotalCents: 999,
      stripeConnectedAccountId: "acct_123",
      providerPaymentIntentId: "pi_1",
      providerSessionId: "cs_1",
    });
    expect(result.outcome).toBe("REJECTED");
    expect(postLedgerEntry).not.toHaveBeenCalled();
  });

  it("returns ALREADY_RECORDED without double-posting when already PAID", async () => {
    findFirstCharge.mockResolvedValue({ ...charge, status: "PAID" });
    const { recordVolunteerAssessmentPayment } = await import("../assessment-payments");
    const result = await recordVolunteerAssessmentPayment({
      organizationId: "org-1",
      chargeId: "charge-1",
      amountTotalCents: 12_500,
      stripeConnectedAccountId: "acct_123",
      providerPaymentIntentId: "pi_1",
      providerSessionId: "cs_1",
    });
    expect(result).toEqual({ outcome: "ALREADY_RECORDED" });
    expect(postLedgerEntry).not.toHaveBeenCalled();
  });

  it("marks PAID and posts one PAYMENT_ELECTRONIC ledger entry for the outstanding amount", async () => {
    findFirstCharge.mockResolvedValue(charge);
    updateManyCharge.mockResolvedValue({ count: 1 });
    const { recordVolunteerAssessmentPayment } = await import("../assessment-payments");
    const result = await recordVolunteerAssessmentPayment({
      organizationId: "org-1",
      chargeId: "charge-1",
      amountTotalCents: 12_500,
      stripeConnectedAccountId: "acct_123",
      providerPaymentIntentId: "pi_1",
      providerSessionId: "cs_1",
    });
    expect(result).toEqual({ outcome: "RECORDED" });
    expect(postLedgerEntry).toHaveBeenCalledWith(expect.objectContaining({ entryType: "PAYMENT_ELECTRONIC", amountCents: 12_500 }));
  });

  it("FC-9: rejects on a connected-account mismatch — a successful event on one org's account can never fulfill another org's charge", async () => {
    findFirstCharge.mockResolvedValue(charge); // charge.stripeConnectedAccountId is "acct_123"
    const { recordVolunteerAssessmentPayment } = await import("../assessment-payments");
    const result = await recordVolunteerAssessmentPayment({
      organizationId: "org-1",
      chargeId: "charge-1",
      amountTotalCents: 12_500,
      stripeConnectedAccountId: "acct_ATTACKER",
      providerPaymentIntentId: "pi_1",
      providerSessionId: "cs_1",
    });
    expect(result).toEqual({ outcome: "REJECTED", reason: "connected account mismatch" });
    expect(updateManyCharge).not.toHaveBeenCalled();
    expect(postLedgerEntry).not.toHaveBeenCalled();
  });

  it("FC-9: loses the settle race gracefully — a concurrent webhook already completed it, no double PAID transition, no double ledger post", async () => {
    findFirstCharge.mockResolvedValue(charge); // findFirst still sees PENDING (read before the race)
    updateManyCharge.mockResolvedValue({ count: 0 }); // but the compare-and-swap update matches nothing -- lost the race
    findUniqueCharge.mockResolvedValue({ ...charge, status: "PAID" }); // the winner already flipped it to PAID
    const { recordVolunteerAssessmentPayment } = await import("../assessment-payments");
    const result = await recordVolunteerAssessmentPayment({
      organizationId: "org-1",
      chargeId: "charge-1",
      amountTotalCents: 12_500,
      stripeConnectedAccountId: "acct_123",
      providerPaymentIntentId: "pi_1",
      providerSessionId: "cs_1",
    });
    expect(result).toEqual({ outcome: "ALREADY_RECORDED" });
    expect(postLedgerEntry).not.toHaveBeenCalled();
  });

  it("FC-9: a truly lost race (neither PENDING/PARTIAL nor PAID at re-check) rejects rather than silently succeeding", async () => {
    findFirstCharge.mockResolvedValue(charge);
    updateManyCharge.mockResolvedValue({ count: 0 });
    findUniqueCharge.mockResolvedValue({ ...charge, status: "PARTIAL" }); // still not PAID -- some other unexpected transition
    const { recordVolunteerAssessmentPayment } = await import("../assessment-payments");
    const result = await recordVolunteerAssessmentPayment({
      organizationId: "org-1",
      chargeId: "charge-1",
      amountTotalCents: 12_500,
      stripeConnectedAccountId: "acct_123",
      providerPaymentIntentId: "pi_1",
      providerSessionId: "cs_1",
    });
    expect(result).toEqual({ outcome: "REJECTED", reason: "lost settle race" });
    expect(postLedgerEntry).not.toHaveBeenCalled();
  });
});

describe("recordOfflineVolunteerAssessmentPayment", () => {
  it("rejects an already-paid charge", async () => {
    findFirstCharge.mockResolvedValue({ ...charge, status: "PAID" });
    const { recordOfflineVolunteerAssessmentPayment } = await import("../assessment-payments");
    await expect(
      recordOfflineVolunteerAssessmentPayment("org-1", "charge-1", { paymentMethod: "CASH" }, { userId: "officer-1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("marks PAID and posts a PAYMENT_OFFLINE ledger entry", async () => {
    findFirstCharge.mockResolvedValue(charge);
    updateCharge.mockResolvedValue({ ...charge, status: "PAID" });
    const { recordOfflineVolunteerAssessmentPayment } = await import("../assessment-payments");
    await recordOfflineVolunteerAssessmentPayment("org-1", "charge-1", { paymentMethod: "CHECK", reference: "1234" }, { userId: "officer-1" });
    expect(postLedgerEntry).toHaveBeenCalledWith(expect.objectContaining({ entryType: "PAYMENT_OFFLINE", amountCents: 12_500 }));
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.assessment_offline_payment_recorded" }));
  });
});
