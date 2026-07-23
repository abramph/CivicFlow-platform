import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueProfile = vi.fn();
const findFirstHousehold = vi.fn();
const findManyCharge = vi.fn();
const findFirstCharge = vi.fn();
const findActiveLink = vi.fn();
const createPaymentReportAndNotify = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaProfile: { findUnique: (...a: unknown[]) => findUniqueProfile(...a) },
    ptaHousehold: { findFirst: (...a: unknown[]) => findFirstHousehold(...a) },
    duesCharge: { findMany: (...a: unknown[]) => findManyCharge(...a), findFirst: (...a: unknown[]) => findFirstCharge(...a) },
  },
}));
vi.mock("@/lib/payment-links", () => ({ findActivePaymentLink: (...a: unknown[]) => findActiveLink(...a) }));
vi.mock("@/lib/payment-reports", () => ({
  createPaymentReportAndNotify: (...a: unknown[]) => createPaymentReportAndNotify(...a),
  DUES_PAYMENT_METHODS: ["CASH", "CHECK", "CREDIT_CARD", "DEBIT_CARD", "CARD", "ACH", "ZELLE", "CASH_APP", "VENMO", "PAYPAL", "STRIPE", "ZEFFY", "OTHER"],
}));

beforeEach(() => vi.clearAllMocks());

describe("getPtaParentDuesSummary — tenant isolation", () => {
  it("cannot read another organization's household", async () => {
    findUniqueProfile.mockResolvedValueOnce(null);
    findFirstHousehold.mockResolvedValueOnce(null);
    const { getPtaParentDuesSummary } = await import("../parent-dues");
    await expect(getPtaParentDuesSummary("org-b", "household-belonging-to-org-a")).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
    expect(findFirstHousehold).toHaveBeenCalledWith({ where: { id: "household-belonging-to-org-a", organizationId: "org-b" } });
  });

  it("scopes the charge query strictly by organizationId and the household's own OrgMember id — never a client-supplied id", async () => {
    findUniqueProfile.mockResolvedValueOnce({ schoolOrPtaName: "Pine Grove", currentSchoolYear: "2026-2027", membershipModel: "HOUSEHOLD", defaultDuesAmountCents: 2500 });
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    findManyCharge.mockResolvedValueOnce([]);
    findActiveLink.mockResolvedValueOnce(null);

    const { getPtaParentDuesSummary } = await import("../parent-dues");
    await getPtaParentDuesSummary("org-a", "household-1");

    expect(findManyCharge).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a", memberId: "member-1" } }));
  });
});

describe("getPtaParentDuesSummary — no billing identity", () => {
  it("returns a safe empty summary rather than throwing when the household has no orgMemberId yet", async () => {
    findUniqueProfile.mockResolvedValueOnce(null);
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: null });

    const { getPtaParentDuesSummary } = await import("../parent-dues");
    const result = await getPtaParentDuesSummary("org-a", "household-1");

    expect(result.hasBillingIdentity).toBe(false);
    expect(result.currentCharge).toBeNull();
    expect(findManyCharge).not.toHaveBeenCalled();
  });
});

describe("getPtaParentDuesSummary — status mapping", () => {
  const baseCharge = {
    id: "charge-1",
    amountDue: 25,
    amountPaid: 0,
    dueDate: new Date("2026-09-01"),
    periodStart: new Date("2026-08-01"),
    periodEnd: new Date("2099-06-30"), // far future so it's picked as "current"
    createdAt: new Date("2026-08-01"),
    payments: [] as { id: string; amount: number; paymentDate: Date; method: string; reference: string | null }[],
    adjustments: [] as { id: string; adjustmentType: string; amount: number; reason: string; createdAt: Date }[],
    paymentReports: [] as { status: string }[],
  };

  async function summarize(overrides: Partial<typeof baseCharge & { status: string }>) {
    findUniqueProfile.mockResolvedValueOnce(null);
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    findManyCharge.mockResolvedValueOnce([{ ...baseCharge, status: "PENDING", ...overrides }]);
    findActiveLink.mockResolvedValueOnce(null);
    const { getPtaParentDuesSummary } = await import("../parent-dues");
    const result = await getPtaParentDuesSummary("org-a", "household-1");
    return result.currentCharge!;
  }

  it("maps PENDING with no reports to UNPAID", async () => {
    const charge = await summarize({ status: "PENDING" });
    expect(charge.status).toBe("UNPAID");
  });

  it("maps PENDING with a pending PaymentReport to PENDING_REVIEW, not UNPAID — a parent shouldn't be told to pay again after already reporting", async () => {
    const charge = await summarize({ status: "PENDING", paymentReports: [{ status: "pending" }] });
    expect(charge.status).toBe("PENDING_REVIEW");
  });

  it("maps PARTIAL to PARTIALLY_PAID and computes the remaining balance correctly", async () => {
    const charge = await summarize({ status: "PARTIAL", amountPaid: 10 });
    expect(charge.status).toBe("PARTIALLY_PAID");
    expect(charge.remainingBalanceCents).toBe(1500);
  });

  it("maps PAID to PAID with zero remaining balance", async () => {
    const charge = await summarize({ status: "PAID", amountPaid: 25 });
    expect(charge.status).toBe("PAID");
    expect(charge.remainingBalanceCents).toBe(0);
  });

  it("maps WAIVED to WAIVED — never fabricates a REFUNDED status since no such DuesChargeStatus exists", async () => {
    const charge = await summarize({ status: "WAIVED" });
    expect(charge.status).toBe("WAIVED");
  });

  it("maps VOID to VOIDED", async () => {
    const charge = await summarize({ status: "VOID" });
    expect(charge.status).toBe("VOIDED");
  });

  it("surfaces adjustments verbatim (type/amount/reason) rather than folding them into a fabricated status", async () => {
    const charge = await summarize({
      status: "PAID",
      amountPaid: 25,
      adjustments: [{ id: "adj-1", adjustmentType: "WRITE_OFF", amount: 25, reason: "Refund issued to family per officer note", createdAt: new Date() }],
    });
    expect(charge.adjustments).toEqual([expect.objectContaining({ type: "WRITE_OFF", amountCents: 2500, reason: "Refund issued to family per officer note" })]);
  });
});

describe("reportPtaDuesPayment — validation and tenant isolation", () => {
  it("rejects a non-positive amount without touching the database", async () => {
    const { reportPtaDuesPayment } = await import("../parent-dues");
    await expect(
      reportPtaDuesPayment({ organizationId: "org-a", householdId: "household-1", actorUserId: "u1", amountCents: 0, paymentMethod: "CASH", paymentDate: new Date() })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(findFirstHousehold).not.toHaveBeenCalled();
  });

  it("cannot report a payment against another organization's household", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    const { reportPtaDuesPayment } = await import("../parent-dues");
    await expect(
      reportPtaDuesPayment({ organizationId: "org-b", householdId: "household-belonging-to-org-a", actorUserId: "u1", amountCents: 2500, paymentMethod: "CASH", paymentDate: new Date() })
    ).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
    expect(createPaymentReportAndNotify).not.toHaveBeenCalled();
  });

  it("refuses to report a payment against another organization's charge, even if the household id is correct", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    findFirstCharge.mockResolvedValueOnce(null);
    const { reportPtaDuesPayment } = await import("../parent-dues");
    await expect(
      reportPtaDuesPayment({ organizationId: "org-a", householdId: "household-1", actorUserId: "u1", duesChargeId: "charge-belonging-to-org-b", amountCents: 2500, paymentMethod: "CASH", paymentDate: new Date() })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("refuses a report against an already-PAID charge", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    findFirstCharge.mockResolvedValueOnce({ id: "charge-1", status: "PAID" });
    const { reportPtaDuesPayment } = await import("../parent-dues");
    await expect(
      reportPtaDuesPayment({ organizationId: "org-a", householdId: "household-1", actorUserId: "u1", duesChargeId: "charge-1", amountCents: 2500, paymentMethod: "CASH", paymentDate: new Date() })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(createPaymentReportAndNotify).not.toHaveBeenCalled();
  });

  it("refuses a report against a WAIVED charge", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    findFirstCharge.mockResolvedValueOnce({ id: "charge-1", status: "WAIVED" });
    const { reportPtaDuesPayment } = await import("../parent-dues");
    await expect(
      reportPtaDuesPayment({ organizationId: "org-a", householdId: "household-1", actorUserId: "u1", duesChargeId: "charge-1", amountCents: 2500, paymentMethod: "CASH", paymentDate: new Date() })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("delegates to createPaymentReportAndNotify() with the household's OrgMember id — never a personal member id", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    findFirstCharge.mockResolvedValueOnce({ id: "charge-1", status: "PENDING" });
    createPaymentReportAndNotify.mockResolvedValueOnce({ id: "report-1" });

    const { reportPtaDuesPayment } = await import("../parent-dues");
    await reportPtaDuesPayment({ organizationId: "org-a", householdId: "household-1", actorUserId: "u1", duesChargeId: "charge-1", amountCents: 2500, paymentMethod: "CASH", paymentDate: new Date() });

    expect(createPaymentReportAndNotify).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-a", memberId: "member-1", amount: 25, category: "MEMBERSHIP_DUES", duesChargeId: "charge-1" }));
  });

  it("rejects reporting for a household with no billing identity", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: null });
    const { reportPtaDuesPayment } = await import("../parent-dues");
    await expect(
      reportPtaDuesPayment({ organizationId: "org-a", householdId: "household-1", actorUserId: "u1", amountCents: 2500, paymentMethod: "CASH", paymentDate: new Date() })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });
});
