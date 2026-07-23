import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstHousehold = vi.fn();
const findFirstDuesAccount = vi.fn();
const createDuesAccount = vi.fn();
const upsertDuesCharge = vi.fn();
const findManyDuesCharge = vi.fn();
const findFirstDuesCharge = vi.fn();
const updateDuesCharge = vi.fn();
const createDuesAdjustment = vi.fn();
const recordDuesPayment = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHousehold: { findFirst: (...a: unknown[]) => findFirstHousehold(...a) },
    duesAccount: { findFirst: (...a: unknown[]) => findFirstDuesAccount(...a), create: (...a: unknown[]) => createDuesAccount(...a) },
    duesCharge: { upsert: (...a: unknown[]) => upsertDuesCharge(...a), findMany: (...a: unknown[]) => findManyDuesCharge(...a), findFirst: (...a: unknown[]) => findFirstDuesCharge(...a), update: (...a: unknown[]) => updateDuesCharge(...a) },
    duesAdjustment: { create: (...a: unknown[]) => createDuesAdjustment(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/dues-payments", () => ({ recordDuesPayment: (...a: unknown[]) => recordDuesPayment(...a) }));

beforeEach(() => vi.clearAllMocks());

describe("PTA dues — reuses the existing OrgMember/DuesAccount/DuesCharge pipeline, never Organization subscription billing", () => {
  it("createPtaDuesCharge scopes the charge to the household's billing-identity OrgMember, never to Organization.plan/Stripe", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    findFirstDuesAccount.mockResolvedValueOnce(null);
    createDuesAccount.mockResolvedValueOnce({ id: "account-1" });
    upsertDuesCharge.mockResolvedValueOnce({ id: "charge-1" });

    const { createPtaDuesCharge } = await import("../dues");
    await createPtaDuesCharge({
      organizationId: "org-a",
      householdId: "household-1",
      amountCents: 2500,
      schoolYear: "2026-2027",
      periodStart: new Date("2026-08-01"),
      periodEnd: new Date("2027-06-30"),
      dueDate: new Date("2026-09-01"),
      actorUserId: "u1",
    });

    // Every dues write is scoped to memberId: "member-1" (the household's
    // OrgMember) — never to any Organization-level field, proving this is
    // the household's own dues, not the org's Unestra subscription.
    expect(createDuesAccount).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ memberId: "member-1" }) }));
    expect(upsertDuesCharge).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ memberId: "member-1", amountDue: 25 }) }));
  });

  it("rejects a non-positive-integer cents amount without ever writing to the database", async () => {
    const { createPtaDuesCharge } = await import("../dues");
    await expect(
      createPtaDuesCharge({ organizationId: "org-a", householdId: "household-1", amountCents: 25.5, schoolYear: "2026-2027", periodStart: new Date(), periodEnd: new Date(), dueDate: new Date(), actorUserId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(findFirstHousehold).not.toHaveBeenCalled();
  });

  it("recordManualPtaDuesPayment delegates to the platform's own recordDuesPayment() rather than reimplementing balance math", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    findFirstDuesCharge.mockResolvedValueOnce({ id: "charge-1", duesAccountId: "account-1", amountPaid: 0, amountDue: 25 });
    recordDuesPayment.mockResolvedValueOnce({ id: "payment-1" });

    const { recordManualPtaDuesPayment } = await import("../dues");
    await recordManualPtaDuesPayment({ organizationId: "org-a", householdId: "household-1", duesChargeId: "charge-1", amountCents: 2500, method: "CHECK", paymentDate: new Date(), actorUserId: "u1" });

    expect(recordDuesPayment).toHaveBeenCalledWith(expect.objectContaining({ memberId: "member-1", duesChargeId: "charge-1", amount: 25 }));
  });

  it("cannot record a payment against another organization's household", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    const { recordManualPtaDuesPayment } = await import("../dues");
    await expect(
      recordManualPtaDuesPayment({ organizationId: "org-b", householdId: "household-belonging-to-org-a", duesChargeId: "charge-1", amountCents: 2500, method: "CHECK", paymentDate: new Date(), actorUserId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
    expect(recordDuesPayment).not.toHaveBeenCalled();
  });

  it("waivePtaDuesCharge sets status WAIVED and records a DuesAdjustment, scoped to the household's own charge", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    findFirstDuesCharge.mockResolvedValueOnce({ id: "charge-1", amountDue: 25, notes: null });
    updateDuesCharge.mockResolvedValueOnce({ id: "charge-1", status: "WAIVED" });

    const { waivePtaDuesCharge } = await import("../dues");
    await waivePtaDuesCharge("org-a", "household-1", "charge-1", "Financial hardship", "u1");

    expect(updateDuesCharge).toHaveBeenCalledWith({ where: { id: "charge-1" }, data: { status: "WAIVED", notes: "Financial hardship" } });
    expect(createDuesAdjustment).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ adjustmentType: "WAIVER", memberId: "member-1" }) }));
  });
});
