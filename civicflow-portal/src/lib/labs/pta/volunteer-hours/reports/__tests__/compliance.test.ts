import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findManyHouseholds = vi.fn();
const findUniqueOrganization = vi.fn();
const findUniqueOrgSettings = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHousehold: { findMany: (...a: unknown[]) => findManyHouseholds(...a), findFirst: vi.fn() },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
  },
}));

const resolveHouseholdRequirement = vi.fn();
vi.mock("../../assignments", () => ({ resolveHouseholdRequirement: (...a: unknown[]) => resolveHouseholdRequirement(...a) }));

const getHouseholdLedgerTotals = vi.fn();
vi.mock("../../ledger", () => ({ getHouseholdLedgerTotals: (...a: unknown[]) => getHouseholdLedgerTotals(...a) }));

const getVolunteerRequirementPeriod = vi.fn();
vi.mock("../../periods", () => ({ getVolunteerRequirementPeriod: (...a: unknown[]) => getVolunteerRequirementPeriod(...a) }));

const resolveVolunteerBuyoutRate = vi.fn();
vi.mock("../../pricing", () => ({ resolveVolunteerBuyoutRate: (...a: unknown[]) => resolveVolunteerBuyoutRate(...a) }));

const HOUSEHOLD = { id: "hh-1", displayName: "The Smiths", status: "ACTIVE", primaryContactAdultId: "adult-1" };

function ledgerTotals(overrides: Partial<Record<string, number>> = {}) {
  return {
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
  findManyHouseholds.mockResolvedValue([HOUSEHOLD]);
  findUniqueOrganization.mockResolvedValue({ name: "Lincoln Elementary PTA" });
  findUniqueOrgSettings.mockResolvedValue({ timezone: "America/Chicago" });
  getVolunteerRequirementPeriod.mockResolvedValue({
    id: "period-1",
    name: "2026-2027 School Year",
    startsOn: new Date("2026-08-01"),
    endsOn: new Date("2027-06-01"),
    timezone: "America/Chicago",
    requiredMinutesDefault: 600,
    volunteerDeadline: new Date("2027-02-01T00:00:00Z"),
  });
  resolveHouseholdRequirement.mockResolvedValue({
    requiredMinutes: 600,
    assignmentType: "STANDARD",
    matchedScopeType: null,
    assignmentId: null,
    reason: null,
    exempt: false,
  });
  getHouseholdLedgerTotals.mockResolvedValue(ledgerTotals());
  resolveVolunteerBuyoutRate.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

const filters = { requirementPeriodId: "period-1" };

describe("buildComplianceReportData — Report D", () => {
  it("estimates a final assessment for a NOT_MET household using the currently active FINAL_ASSESSMENT rate (includeFinancials=true)", async () => {
    getHouseholdLedgerTotals.mockResolvedValue(ledgerTotals({ verifiedMinutes: 240, eventMinutes: 240 }));
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-1", amountCents: 2_000, rateType: "FINAL_ASSESSMENT" });

    const { buildComplianceReportData } = await import("../compliance");
    const data = await buildComplianceReportData("org-1", filters, "Officer Jones", true);

    expect(data.rows).toHaveLength(1);
    const row = data.rows[0];
    expect(row.remainingMinutes).toBe(360);
    expect(row.completionStatus).toBe("NOT_MET");
    expect(row.estimatedFinalAssessmentCents).toBe(12_000);
    expect(row.daysRemainingOrOverdue).toBe(31);
    expect(data.summary.totalAssessmentsCents).toBe(12_000);
  });

  it("never estimates an assessment when no FINAL_ASSESSMENT window is active — never fabricates a rate", async () => {
    getHouseholdLedgerTotals.mockResolvedValue(ledgerTotals({ verifiedMinutes: 240 }));
    resolveVolunteerBuyoutRate.mockResolvedValue(null);
    const { buildComplianceReportData } = await import("../compliance");
    const data = await buildComplianceReportData("org-1", filters, "Officer Jones", true);
    expect(data.rows[0].estimatedFinalAssessmentCents).toBeNull();
  });

  it("never estimates an assessment for a MET household even when a rate is active", async () => {
    getHouseholdLedgerTotals.mockResolvedValue(ledgerTotals({ verifiedMinutes: 600, eventMinutes: 600 }));
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-1", amountCents: 2_000, rateType: "FINAL_ASSESSMENT" });
    const { buildComplianceReportData } = await import("../compliance");
    const data = await buildComplianceReportData("org-1", filters, "Officer Jones", true);
    expect(data.rows[0].completionStatus).toBe("MET");
    expect(data.rows[0].estimatedFinalAssessmentCents).toBeNull();
  });

  describe("RV-12: financial-permission gating (found unconditionally leaking during re-verification, fixed like FC-3's Report A)", () => {
    it("defaults to withholding the dollar field entirely when includeFinancials is omitted", async () => {
      getHouseholdLedgerTotals.mockResolvedValue(ledgerTotals({ verifiedMinutes: 240, eventMinutes: 240 }));
      resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-1", amountCents: 2_000, rateType: "FINAL_ASSESSMENT" });
      const { buildComplianceReportData } = await import("../compliance");
      const data = await buildComplianceReportData("org-1", filters, "Officer Jones");
      expect(data.rows[0].estimatedFinalAssessmentCents).toBeUndefined();
      expect(data.summary.totalAssessmentsCents).toBeUndefined();
      // The literal review requirement: after JSON serialization (exactly
      // what Response.json() does), the field NAME itself must not appear,
      // not merely hold a redacted value.
      expect(Object.keys(JSON.parse(JSON.stringify(data.rows[0])))).not.toContain("estimatedFinalAssessmentCents");
      expect(Object.keys(JSON.parse(JSON.stringify(data.summary)))).not.toContain("totalAssessmentsCents");
    });

    it("explicit includeFinancials=false behaves identically to the default", async () => {
      getHouseholdLedgerTotals.mockResolvedValue(ledgerTotals({ verifiedMinutes: 240, eventMinutes: 240 }));
      resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-1", amountCents: 2_000, rateType: "FINAL_ASSESSMENT" });
      const { buildComplianceReportData } = await import("../compliance");
      const data = await buildComplianceReportData("org-1", filters, "Officer Jones", false);
      expect(data.rows[0].estimatedFinalAssessmentCents).toBeUndefined();
      expect(data.summary.totalAssessmentsCents).toBeUndefined();
    });

    it("getComplianceColumns(false) omits the financial column entirely -- a non-financial workbook never even shows the header", async () => {
      const { getComplianceColumns } = await import("../compliance");
      const nonFinancialColumns = getComplianceColumns(false);
      expect(nonFinancialColumns.find((c) => c.header === "Est. final assessment")).toBeUndefined();
      const financialColumns = getComplianceColumns(true);
      expect(financialColumns.find((c) => c.header === "Est. final assessment")).toBeDefined();
    });
  });

  it("filters to only NOT_MET rows when complianceFilter=NOT_MET", async () => {
    getHouseholdLedgerTotals.mockResolvedValue(ledgerTotals({ verifiedMinutes: 600, eventMinutes: 600 }));
    const { buildComplianceReportData } = await import("../compliance");
    const data = await buildComplianceReportData("org-1", { ...filters, complianceFilter: "NOT_MET" }, "Officer Jones");
    expect(data.rows).toHaveLength(0);
  });

  it("EXEMPT households are excluded by complianceFilter=NOT_MET and included by complianceFilter=EXEMPT", async () => {
    resolveHouseholdRequirement.mockResolvedValue({
      requiredMinutes: 0,
      assignmentType: "EXEMPT_FULL",
      matchedScopeType: null,
      assignmentId: "assign-1",
      reason: "Approved exemption",
      exempt: true,
    });
    const { buildComplianceReportData } = await import("../compliance");
    const notMet = await buildComplianceReportData("org-1", { ...filters, complianceFilter: "NOT_MET" }, "Officer Jones");
    expect(notMet.rows).toHaveLength(0);
    const exempt = await buildComplianceReportData("org-1", { ...filters, complianceFilter: "EXEMPT" }, "Officer Jones");
    expect(exempt.rows).toHaveLength(1);
    expect(exempt.rows[0].exemptionOrAdjustmentIndicator).toBe("Approved exemption");
  });

  it("COMPLIANCE_COLUMNS.getValue reads the exact fields present on the row", async () => {
    getHouseholdLedgerTotals.mockResolvedValue(ledgerTotals({ verifiedMinutes: 240, eventMinutes: 240 }));
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-1", amountCents: 2_000, rateType: "FINAL_ASSESSMENT" });
    const { buildComplianceReportData, COMPLIANCE_COLUMNS } = await import("../compliance");
    const data = await buildComplianceReportData("org-1", filters, "Officer Jones");
    const row = data.rows[0];
    for (const col of COMPLIANCE_COLUMNS) {
      expect(() => col.getValue(row)).not.toThrow();
    }
    const statusCol = COMPLIANCE_COLUMNS.find((c) => c.header === "Status")!;
    expect(statusCol.getValue(row)).toBe("NOT_MET");
  });
});
