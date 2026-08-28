import { beforeEach, describe, expect, it, vi } from "vitest";

const adjustPtaVolunteerHourEntry = vi.fn();
vi.mock("../../volunteers", () => ({ adjustPtaVolunteerHourEntry: (...a: unknown[]) => adjustPtaVolunteerHourEntry(...a) }));

const resolveHouseholdRequirement = vi.fn();
vi.mock("../assignments", () => ({ resolveHouseholdRequirement: (...a: unknown[]) => resolveHouseholdRequirement(...a) }));

const getHouseholdLedgerTotals = vi.fn();
const postLedgerEntry = vi.fn().mockResolvedValue({ id: "ledger-1" });
vi.mock("../ledger", () => ({
  getHouseholdLedgerTotals: (...a: unknown[]) => getHouseholdLedgerTotals(...a),
  postLedgerEntry: (...a: unknown[]) => postLedgerEntry(...a),
}));

const findFirstAssessmentCharge = vi.fn();
const findFirstPurchase = vi.fn();
const updatePurchase = vi.fn();
const findFirstReviewFlag = vi.fn();
const createReviewFlagMock = vi.fn();
const updateReviewFlag = vi.fn();
const findUniqueStripeAccount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerAssessmentCharge: { findFirst: (...a: unknown[]) => findFirstAssessmentCharge(...a) },
    ptaVolunteerBuyoutPurchase: {
      findFirst: (...a: unknown[]) => findFirstPurchase(...a),
      update: (...a: unknown[]) => updatePurchase(...a),
    },
    ptaVolunteerReviewFlag: {
      create: (...a: unknown[]) => createReviewFlagMock(...a),
      findFirst: (...a: unknown[]) => findFirstReviewFlag(...a),
      findMany: vi.fn(),
      update: (...a: unknown[]) => updateReviewFlag(...a),
    },
    organizationStripeAccount: { findUnique: (...a: unknown[]) => findUniqueStripeAccount(...a) },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

const stripeRefundsCreate = vi.fn();
vi.mock("@/lib/payments/stripe-connect", () => ({
  getStripeForMode: vi.fn().mockResolvedValue({ refunds: { create: (...a: unknown[]) => stripeRefundsCreate(...a) } }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  createReviewFlagMock.mockResolvedValue({ id: "flag-1" });
});

const actor = { userId: "officer-1", userEmail: "officer@example.com" };

describe("reverseHourEntry", () => {
  it("delegates to the existing adjustPtaVolunteerHourEntry (never a parallel correction path)", async () => {
    adjustPtaVolunteerHourEntry.mockResolvedValue({ id: "he-1", householdId: "hh-1", creditedMinutes: 90 });
    findFirstAssessmentCharge.mockResolvedValue(null);
    const { reverseHourEntry } = await import("../corrections");
    await reverseHourEntry("org-1", "he-1", -30, "over-reported", actor);
    expect(adjustPtaVolunteerHourEntry).toHaveBeenCalledWith("org-1", "he-1", -30, "over-reported", "officer-1", "officer@example.com");
  });

  it("does not flag when no assessment has been posted for the household", async () => {
    adjustPtaVolunteerHourEntry.mockResolvedValue({ id: "he-1", householdId: "hh-1" });
    findFirstAssessmentCharge.mockResolvedValue(null);
    const { reverseHourEntry } = await import("../corrections");
    const result = await reverseHourEntry("org-1", "he-1", -30, "correction", actor);
    expect(result.flagged).toBe(false);
    expect(createReviewFlagMock).not.toHaveBeenCalled();
  });

  it("flags for review when an assessment was already posted for this household — never auto-charges", async () => {
    adjustPtaVolunteerHourEntry.mockResolvedValue({ id: "he-1", householdId: "hh-1" });
    findFirstAssessmentCharge.mockResolvedValue({ id: "charge-1", requirementPeriodId: "period-1" });
    const { reverseHourEntry } = await import("../corrections");
    const result = await reverseHourEntry("org-1", "he-1", -30, "correction after assessment", actor);
    expect(result.flagged).toBe(true);
    expect(createReviewFlagMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flagType: "CORRECTION_AFTER_ASSESSMENT_POSTED" }) })
    );
  });
});

const purchase = {
  id: "purchase-1",
  organizationId: "org-1",
  requirementPeriodId: "period-1",
  householdId: "hh-1",
  hoursElectedMinutes: 480,
  totalCents: 12_000,
  refundedMinutes: 0,
  refundedAmountCents: 0,
  status: "COMPLETED",
  paymentMethod: "STRIPE",
  providerPaymentIntentId: "pi_1",
  stripeConnectedAccountId: "acct_123",
};

const emptyTotals = {
  verifiedMinutes: 0,
  eventMinutes: 0,
  nonEventMinutes: 0,
  pendingMinutes: 0,
  rejectedMinutes: 0,
  purchasedMinutes: 0,
  creditMinutes: 0,
  waivedMinutes: 0,
  assessmentChargeCents: 0,
  paidElectronicCents: 0,
  paidOfflineCents: 0,
  refundedCents: 0,
  writtenOffCents: 0,
  outstandingBalanceCents: 0,
};

describe("refundPurchasedHours — validation", () => {
  it("requires a reason", async () => {
    const { refundPurchasedHours } = await import("../corrections");
    await expect(
      refundPurchasedHours("org-1", "purchase-1", { refundMinutes: 60, refundAmountCents: 1500, reason: "  " }, actor)
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("rejects a refund exceeding the remaining refundable minutes", async () => {
    findFirstPurchase.mockResolvedValue(purchase);
    const { refundPurchasedHours } = await import("../corrections");
    await expect(
      refundPurchasedHours("org-1", "purchase-1", { refundMinutes: 600, refundAmountCents: 1000, reason: "x" }, actor)
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("rejects a refund exceeding the remaining refundable amount", async () => {
    findFirstPurchase.mockResolvedValue(purchase);
    const { refundPurchasedHours } = await import("../corrections");
    await expect(
      refundPurchasedHours("org-1", "purchase-1", { refundMinutes: 60, refundAmountCents: 999_999, reason: "x" }, actor)
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("rejects refunding a purchase that was never completed", async () => {
    findFirstPurchase.mockResolvedValue({ ...purchase, status: "PENDING" });
    const { refundPurchasedHours } = await import("../corrections");
    await expect(
      refundPurchasedHours("org-1", "purchase-1", { refundMinutes: 60, refundAmountCents: 1500, reason: "x" }, actor)
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });
});

describe("refundPurchasedHours — Stripe path", () => {
  it("refunds against the purchase's OWN stored connected account, never a current-settings lookup", async () => {
    findFirstPurchase.mockResolvedValue(purchase);
    findUniqueStripeAccount.mockResolvedValue({ accountMode: "test" });
    stripeRefundsCreate.mockResolvedValue({ id: "re_123", status: "succeeded" });
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({ ...emptyTotals, verifiedMinutes: 1200 });

    const { refundPurchasedHours } = await import("../corrections");
    await refundPurchasedHours("org-1", "purchase-1", { refundMinutes: 240, refundAmountCents: 6_000, reason: "family cancelled" }, actor);

    expect(stripeRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_1", amount: 6_000 }),
      { stripeAccount: "acct_123" }
    );
    expect(postLedgerEntry).toHaveBeenCalledWith(expect.objectContaining({ entryType: "PURCHASE_REFUND", minutes: 240, amountCents: 6_000, sourceId: "re_123" }));
    expect(postLedgerEntry).toHaveBeenCalledWith(expect.objectContaining({ entryType: "REFUND", amountCents: 6_000, sourceId: "re_123" }));
  });

  it("marks the purchase REFUNDED when the refund covers all remaining hours", async () => {
    findFirstPurchase.mockResolvedValue(purchase);
    findUniqueStripeAccount.mockResolvedValue({ accountMode: "test" });
    stripeRefundsCreate.mockResolvedValue({ id: "re_full", status: "succeeded" });
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue(emptyTotals);

    const { refundPurchasedHours } = await import("../corrections");
    await refundPurchasedHours("org-1", "purchase-1", { refundMinutes: 480, refundAmountCents: 12_000, reason: "full refund" }, actor);

    expect(updatePurchase).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "REFUNDED" }) }));
  });
});

describe("refundPurchasedHours — offline path & deficit warning", () => {
  it("skips Stripe entirely for an offline-paid purchase", async () => {
    findFirstPurchase.mockResolvedValue({ ...purchase, paymentMethod: "CHECK", providerPaymentIntentId: null, stripeConnectedAccountId: null });
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({ ...emptyTotals, verifiedMinutes: 1200 });

    const { refundPurchasedHours } = await import("../corrections");
    await refundPurchasedHours("org-1", "purchase-1", { refundMinutes: 240, refundAmountCents: 6_000, reason: "goodwill" }, actor);

    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it("warns (and flags) when the refund leaves the family with hours still owed", async () => {
    findFirstPurchase.mockResolvedValue({ ...purchase, paymentMethod: "CHECK", providerPaymentIntentId: null, stripeConnectedAccountId: null });
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({ ...emptyTotals, verifiedMinutes: 600, purchasedMinutes: 0 }); // after reversing purchase, only 600 verified vs 1200 required

    const { refundPurchasedHours } = await import("../corrections");
    const result = await refundPurchasedHours("org-1", "purchase-1", { refundMinutes: 480, refundAmountCents: 12_000, reason: "family disputed" }, actor);

    expect(result.deficitWarning).toBe(true);
    expect(createReviewFlagMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ flagType: "REFUND_CREATES_DEFICIT" }) }));
  });

  it("does not warn when the family still meets their requirement after the refund", async () => {
    findFirstPurchase.mockResolvedValue({ ...purchase, paymentMethod: "CHECK", providerPaymentIntentId: null, stripeConnectedAccountId: null });
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({ ...emptyTotals, verifiedMinutes: 1200 });

    const { refundPurchasedHours } = await import("../corrections");
    const result = await refundPurchasedHours("org-1", "purchase-1", { refundMinutes: 240, refundAmountCents: 6_000, reason: "partial refund" }, actor);

    expect(result.deficitWarning).toBe(false);
  });
});

describe("checkForOverpaymentAfterRequirementChange", () => {
  it("detects an overpayment only when purchased hours contributed to the excess", async () => {
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 600, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({ ...emptyTotals, purchasedMinutes: 480, verifiedMinutes: 300 }); // satisfied 780 vs required 600

    const { checkForOverpaymentAfterRequirementChange } = await import("../corrections");
    const result = await checkForOverpaymentAfterRequirementChange("org-1", "period-1", "hh-1");

    expect(result).toMatchObject({ overpaymentDetected: true, requiredMinutes: 600, satisfiedMinutes: 780, excessMinutes: 180 });
    expect(createReviewFlagMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flagType: "POTENTIAL_OVERPAYMENT_AFTER_REQUIREMENT_REDUCED" }) })
    );
  });

  it("does not flag pure over-volunteering (excess with zero purchased minutes) — not a financial concern", async () => {
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 600, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({ ...emptyTotals, verifiedMinutes: 900, purchasedMinutes: 0 });

    const { checkForOverpaymentAfterRequirementChange } = await import("../corrections");
    const result = await checkForOverpaymentAfterRequirementChange("org-1", "period-1", "hh-1");

    expect(result.overpaymentDetected).toBe(false);
    expect(createReviewFlagMock).not.toHaveBeenCalled();
  });

  it("does not flag when satisfied minutes are below the requirement", async () => {
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({ ...emptyTotals, verifiedMinutes: 300, purchasedMinutes: 180 });

    const { checkForOverpaymentAfterRequirementChange } = await import("../corrections");
    const result = await checkForOverpaymentAfterRequirementChange("org-1", "period-1", "hh-1");

    expect(result.overpaymentDetected).toBe(false);
  });
});

describe("resolveReviewFlag", () => {
  it("throws for a flag not in this organization", async () => {
    findFirstReviewFlag.mockResolvedValue(null);
    const { resolveReviewFlag } = await import("../corrections");
    await expect(resolveReviewFlag("org-1", "flag-1", "handled", { userId: "u1" })).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("marks RESOLVED and writes an audit event", async () => {
    findFirstReviewFlag.mockResolvedValue({ id: "flag-1" });
    updateReviewFlag.mockResolvedValue({ id: "flag-1", status: "RESOLVED" });
    const { resolveReviewFlag } = await import("../corrections");
    await resolveReviewFlag("org-1", "flag-1", "confirmed with family", { userId: "u1" });
    expect(updateReviewFlag).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "RESOLVED", resolutionNotes: "confirmed with family" }) })
    );
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.review_flag_resolved" }));
  });
});
