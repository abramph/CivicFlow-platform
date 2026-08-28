import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyPurchases = vi.fn();
const findManyCharges = vi.fn();
const findManyHouseholds = vi.fn();
const findManyUsers = vi.fn();
const findUniqueOrganization = vi.fn();
const findUniqueOrgSettings = vi.fn();
const findFirstPeriod = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerBuyoutPurchase: { findMany: (...a: unknown[]) => findManyPurchases(...a) },
    ptaVolunteerAssessmentCharge: { findMany: (...a: unknown[]) => findManyCharges(...a) },
    ptaHousehold: { findMany: (...a: unknown[]) => findManyHouseholds(...a), findFirst: vi.fn() },
    user: { findMany: (...a: unknown[]) => findManyUsers(...a) },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    ptaVolunteerRequirementPeriod: { findFirst: (...a: unknown[]) => findFirstPeriod(...a) },
  },
}));

const HOUSEHOLD = { id: "hh-1", displayName: "The Smiths" };
const RECORDER = { id: "user-1", displayName: "Officer Jones", email: "officer@example.com" };

const PURCHASE = {
  id: "purchase-1",
  organizationId: "org-1",
  householdId: "hh-1",
  electionType: "FULL_BUYOUT" as const,
  hoursElectedMinutes: 600,
  rateType: "FULL_BUYOUT" as const,
  baseAmountCents: 15_000,
  coverageAmountCents: 500,
  totalCents: 15_500,
  status: "COMPLETED" as const,
  paymentMethod: "STRIPE" as const,
  recordedByUserId: null,
  refundedAmountCents: 0,
  completedAt: new Date("2026-10-01T00:00:00Z"),
  createdAt: new Date("2026-09-28T00:00:00Z"),
};

const CHARGE = {
  id: "charge-1",
  organizationId: "org-1",
  householdId: "hh-1",
  amountCents: 9_000,
  amountPaidCents: 3_000,
  refundedCents: 0,
  status: "PARTIAL" as const,
  paymentMethod: "CASH" as const,
  recordedByUserId: "user-1",
  paidAt: new Date("2026-11-01T00:00:00Z"),
  createdAt: new Date("2026-10-25T00:00:00Z"),
  line: { remainingMinutes: 180 },
};

beforeEach(() => {
  vi.clearAllMocks();
  findManyPurchases.mockResolvedValue([PURCHASE]);
  findManyCharges.mockResolvedValue([CHARGE]);
  findManyHouseholds.mockResolvedValue([HOUSEHOLD]);
  findManyUsers.mockResolvedValue([RECORDER]);
  findUniqueOrganization.mockResolvedValue({ name: "Lincoln Elementary PTA" });
  findUniqueOrgSettings.mockResolvedValue({ timezone: "America/Chicago" });
  findFirstPeriod.mockResolvedValue({
    id: "period-1",
    name: "2026-2027 School Year",
    startsOn: new Date("2026-08-01"),
    endsOn: new Date("2027-06-01"),
    timezone: "America/Chicago",
  });
});

const filters = { requirementPeriodId: "period-1" };

describe("buildFinancialReportData — Report E", () => {
  it("produces one row per completed buyout purchase and one per non-void assessment charge", async () => {
    const { buildFinancialReportData } = await import("../financial");
    const data = await buildFinancialReportData("org-1", filters, "Treasurer Lee");
    expect(data.rows).toHaveLength(2);
    const purchaseRow = data.rows.find((r) => r.transactionType === "BUYOUT_PURCHASE")!;
    expect(purchaseRow.householdDisplayName).toBe("The Smiths");
    expect(purchaseRow.amountPaidCents).toBe(15_500);
    expect(purchaseRow.hoursMinutes).toBe(600);

    const chargeRow = data.rows.find((r) => r.transactionType === "ASSESSMENT_CHARGE")!;
    expect(chargeRow.outstandingCents).toBe(6_000);
    expect(chargeRow.hoursMinutes).toBe(180);
    expect(chargeRow.recordedByName).toBe("Officer Jones");
  });

  it("nets a refund against the purchase's paid amount", async () => {
    findManyPurchases.mockResolvedValue([{ ...PURCHASE, status: "REFUNDED", refundedAmountCents: 5_000 }]);
    findManyCharges.mockResolvedValue([]);
    const { buildFinancialReportData } = await import("../financial");
    const data = await buildFinancialReportData("org-1", filters, "Treasurer Lee");
    expect(data.rows[0].amountPaidCents).toBe(10_500);
    expect(data.rows[0].refundedCents).toBe(5_000);
  });

  it("excludes VOID assessment charges and PENDING/FAILED purchases from the transaction list", async () => {
    findManyPurchases.mockResolvedValue([]);
    findManyCharges.mockResolvedValue([]);
    const { buildFinancialReportData } = await import("../financial");
    await buildFinancialReportData("org-1", filters, "Treasurer Lee");
    expect(findManyPurchases).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: ["COMPLETED", "REFUNDED"] } }) }));
    expect(findManyCharges).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { not: "VOID" } }) }));
  });

  it("sums buyout revenue and outstanding assessment balance into the summary", async () => {
    const { buildFinancialReportData } = await import("../financial");
    const data = await buildFinancialReportData("org-1", filters, "Treasurer Lee");
    expect(data.summary.totalBuyoutRevenueCents).toBe(15_500);
    expect(data.summary.totalAssessmentsCents).toBe(9_000);
    expect(data.summary.outstandingBalanceCents).toBe(6_000);
    expect(data.summary.totalFamilies).toBe(1);
  });

  it("FINANCIAL_COLUMNS.getValue reads the exact fields present on the row", async () => {
    const { buildFinancialReportData, FINANCIAL_COLUMNS } = await import("../financial");
    const data = await buildFinancialReportData("org-1", filters, "Treasurer Lee");
    for (const row of data.rows) {
      for (const col of FINANCIAL_COLUMNS) {
        expect(() => col.getValue(row)).not.toThrow();
      }
    }
  });
});
