import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyHouseholds = vi.fn();
const findUniqueHousehold = vi.fn();
const findManyStudents = vi.fn();
const findManyPurchases = vi.fn();
const findManyCharges = vi.fn();
const findFirstLedgerEntry = vi.fn();
const findUniqueOrganization = vi.fn();
const findUniqueOrgSettings = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHousehold: {
      findMany: (...a: unknown[]) => findManyHouseholds(...a),
      findUnique: (...a: unknown[]) => findUniqueHousehold(...a),
      findFirst: vi.fn(),
    },
    ptaStudent: { findMany: (...a: unknown[]) => findManyStudents(...a) },
    ptaVolunteerBuyoutPurchase: { findMany: (...a: unknown[]) => findManyPurchases(...a) },
    ptaVolunteerAssessmentCharge: { findMany: (...a: unknown[]) => findManyCharges(...a) },
    ptaVolunteerLedgerEntry: { findFirst: (...a: unknown[]) => findFirstLedgerEntry(...a) },
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
  findManyHouseholds.mockResolvedValue([HOUSEHOLD]);
  findUniqueHousehold.mockResolvedValue({ primaryContact: { name: "Jane Smith", email: "jane@example.com" } });
  findManyStudents.mockResolvedValue([{ displayName: "Alex Smith" }, { displayName: "Sam Smith" }]);
  findManyPurchases.mockResolvedValue([]);
  findManyCharges.mockResolvedValue([]);
  findFirstLedgerEntry.mockResolvedValue(null);
  findUniqueOrganization.mockResolvedValue({ name: "Lincoln Elementary PTA" });
  findUniqueOrgSettings.mockResolvedValue({ timezone: "America/Chicago" });
  getVolunteerRequirementPeriod.mockResolvedValue({
    id: "period-1",
    name: "2026-2027 School Year",
    startsOn: new Date("2026-08-01"),
    endsOn: new Date("2027-06-01"),
    timezone: "America/Chicago",
    requiredMinutesDefault: 600,
    volunteerDeadline: new Date("2027-05-01"),
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
});

const filters = { requirementPeriodId: "period-1" };

describe("buildFamilySummaryReportData — Report A", () => {
  it("computes MET_COMBINED, 100% completion, and buyout revenue when service + purchase together satisfy the requirement", async () => {
    getHouseholdLedgerTotals.mockResolvedValue(ledgerTotals({ verifiedMinutes: 300, eventMinutes: 200, nonEventMinutes: 100, purchasedMinutes: 300 }));
    findManyPurchases.mockResolvedValue([{ baseAmountCents: 15_000, coverageAmountCents: 500, refundedAmountCents: 0 }]);
    findFirstLedgerEntry.mockResolvedValue({ effectiveDate: new Date("2026-11-01") });

    const { buildFamilySummaryReportData } = await import("../family-summary");
    const data = await buildFamilySummaryReportData("org-1", filters, "Officer Jones");

    expect(data.rows).toHaveLength(1);
    const row = data.rows[0];
    expect(row.householdDisplayName).toBe("The Smiths");
    expect(row.studentNames).toBe("Alex Smith, Sam Smith");
    expect(row.remainingMinutes).toBe(0);
    expect(row.completionPercent).toBe(100);
    expect(row.requirementStatus).toBe("MET_COMBINED");
    expect(row.buyoutAmountPaidCents).toBe(15_500);
    expect(row.lastVolunteerDate).toEqual(new Date("2026-11-01"));
    expect(data.summary.totalFamilies).toBe(1);
    expect(data.summary.familiesMeetingRequirement).toBe(1);
  });

  it("computes NOT_STARTED when nothing has been verified or purchased and no deadline has passed", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue({
      id: "period-1",
      name: "2026-2027 School Year",
      startsOn: new Date("2026-08-01"),
      endsOn: new Date("2027-06-01"),
      timezone: "America/Chicago",
      requiredMinutesDefault: 600,
      volunteerDeadline: new Date("2099-01-01"),
    });
    const { buildFamilySummaryReportData } = await import("../family-summary");
    const data = await buildFamilySummaryReportData("org-1", filters, "Officer Jones");
    expect(data.rows[0].requirementStatus).toBe("NOT_STARTED");
    expect(data.rows[0].remainingMinutes).toBe(600);
  });

  it("computes OVERDUE once the deadline has passed with hours still remaining", async () => {
    getHouseholdLedgerTotals.mockResolvedValue(ledgerTotals({ verifiedMinutes: 60, eventMinutes: 60 }));
    getVolunteerRequirementPeriod.mockResolvedValue({
      id: "period-1",
      name: "2026-2027 School Year",
      startsOn: new Date("2026-08-01"),
      endsOn: new Date("2027-06-01"),
      timezone: "America/Chicago",
      requiredMinutesDefault: 600,
      volunteerDeadline: new Date("2000-01-01"),
    });
    const { buildFamilySummaryReportData } = await import("../family-summary");
    const data = await buildFamilySummaryReportData("org-1", filters, "Officer Jones");
    expect(data.rows[0].requirementStatus).toBe("OVERDUE");
  });

  it("marks EXEMPT households as exempt regardless of hours logged, and never counts them toward not-meeting", async () => {
    resolveHouseholdRequirement.mockResolvedValue({
      requiredMinutes: 0,
      assignmentType: "EXEMPT_FULL",
      matchedScopeType: null,
      assignmentId: "assign-1",
      reason: "Medical exemption on file",
      exempt: true,
    });
    const { buildFamilySummaryReportData } = await import("../family-summary");
    const data = await buildFamilySummaryReportData("org-1", filters, "Officer Jones");
    expect(data.rows[0].requirementStatus).toBe("EXEMPT");
    expect(data.rows[0].noteOrExceptionIndicator).toBe("Medical exemption on file");
    expect(data.summary.familiesExempt).toBe(1);
    expect(data.summary.familiesNotMeetingRequirement).toBe(0);
  });

  it("reflects a pending assessment charge as ASSESSMENT_DUE with an outstanding balance", async () => {
    getHouseholdLedgerTotals.mockResolvedValue(ledgerTotals({ verifiedMinutes: 60 }));
    findManyCharges.mockResolvedValue([{ amountCents: 9000, amountPaidCents: 0, status: "PENDING" }]);
    const { buildFamilySummaryReportData } = await import("../family-summary");
    const data = await buildFamilySummaryReportData("org-1", filters, "Officer Jones");
    expect(data.rows[0].requirementStatus).toBe("ASSESSMENT_DUE");
    expect(data.rows[0].outstandingBalanceCents).toBe(9000);
    expect(data.rows[0].paymentStatus).toBe("Balance due");
    expect(data.summary.outstandingBalanceCents).toBe(9000);
  });

  it("filters rows to the requested requirementStatus, excluding everything else", async () => {
    const { buildFamilySummaryReportData } = await import("../family-summary");
    const data = await buildFamilySummaryReportData("org-1", { ...filters, requirementStatus: "MET_SERVICE" }, "Officer Jones");
    expect(data.rows).toHaveLength(0);
  });

  it("FAMILY_SUMMARY_COLUMNS.getValue reads the exact fields present on the row (headers can never silently drift from the data)", async () => {
    getHouseholdLedgerTotals.mockResolvedValue(ledgerTotals({ verifiedMinutes: 120, eventMinutes: 120 }));
    const { buildFamilySummaryReportData, FAMILY_SUMMARY_COLUMNS } = await import("../family-summary");
    const data = await buildFamilySummaryReportData("org-1", filters, "Officer Jones");
    const row = data.rows[0];
    for (const col of FAMILY_SUMMARY_COLUMNS) {
      expect(() => col.getValue(row)).not.toThrow();
    }
    const familyCol = FAMILY_SUMMARY_COLUMNS.find((c) => c.header === "Family")!;
    expect(familyCol.getValue(row)).toBe("The Smiths");
  });
});
