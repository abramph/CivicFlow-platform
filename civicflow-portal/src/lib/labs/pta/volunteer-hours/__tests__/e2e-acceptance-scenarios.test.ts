import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Volunteer Hour Requirements & Buyout program, VH-L (docs/pta-volunteer-hours.md).
 *
 * Chained end-to-end test of the plan's 4 acceptance scenarios (family
 * totals, event report, buyout math, assessment math), built from ONE
 * shared fixture rather than four independent ones. The point isn't to
 * re-verify each report's own logic in isolation — that's already covered
 * by VH-J/VH-K's per-report unit tests — it's to prove that Reports A
 * (family totals), C (event report), D (assessment math), and E (buyout +
 * assessment math) all agree with each other and with hand-computed
 * expected values when fed the exact same underlying household/ledger
 * state. If any report's math ever silently drifted from another's, this
 * is the test that would catch it.
 *
 * Fixture: household "The Smiths" has a 600-minute (10h) requirement.
 * They verified 180 minutes (3h, all event-based, tied to "Fall Festival").
 * They bought out 120 minutes (2h) at a $25/hr PER_HOUR rate = $50.00.
 * That leaves 300 minutes (5h) remaining, on which a $20/hr FINAL_ASSESSMENT
 * rate produces a $100.00 assessment charge.
 */

const REQUIRED_MINUTES = 600;
const VERIFIED_MINUTES = 180;
const PURCHASED_MINUTES = 120;
const REMAINING_MINUTES = REQUIRED_MINUTES - VERIFIED_MINUTES - PURCHASED_MINUTES; // 300
const PURCHASE_RATE_CENTS_PER_HOUR = 2_500;
const PURCHASE_TOTAL_CENTS = Math.round((PURCHASED_MINUTES / 60) * PURCHASE_RATE_CENTS_PER_HOUR); // 5,000
const ASSESSMENT_RATE_CENTS_PER_HOUR = 2_000;
const ASSESSMENT_TOTAL_CENTS = Math.round((REMAINING_MINUTES / 60) * ASSESSMENT_RATE_CENTS_PER_HOUR); // 10,000

const HOUSEHOLD = { id: "hh-1", displayName: "The Smiths", status: "ACTIVE", primaryContactAdultId: "adult-1" };
const HOUSEHOLD_WITH_CONTACT = { id: "hh-1", primaryContact: { name: "Jane Smith", email: "jane@example.com" } };

const PERIOD = {
  id: "period-1",
  name: "2026-2027 School Year",
  startsOn: new Date("2026-08-01"),
  endsOn: new Date("2027-06-01"),
  timezone: "America/Chicago",
  requiredMinutesDefault: REQUIRED_MINUTES,
  volunteerDeadline: new Date("2027-05-01"),
  status: "ACTIVE" as const,
};

const REQUIREMENT = {
  requiredMinutes: REQUIRED_MINUTES,
  assignmentType: "STANDARD" as const,
  matchedScopeType: null,
  assignmentId: null,
  reason: null,
  exempt: false,
};

// ── Shared mocks every report module in this test ultimately touches ──────
const findManyHouseholds = vi.fn();
const findUniqueHousehold = vi.fn();
const findManyStudents = vi.fn();
const findManyPurchases = vi.fn();
const findManyCharges = vi.fn();
const findFirstLedgerEntry = vi.fn();
const findUniqueOrganization = vi.fn();
const findUniqueOrgSettings = vi.fn();
const findManyOpportunities = vi.fn();
const findManySlots = vi.fn();
const findManySignups = vi.fn();
const findManyEntries = vi.fn();
const findManyRecorders = vi.fn();
const findManyLedgerEntries = vi.fn();

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
    ptaVolunteerLedgerEntry: {
      findFirst: (...a: unknown[]) => findFirstLedgerEntry(...a),
      findMany: (...a: unknown[]) => findManyLedgerEntries(...a),
    },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    ptaVolunteerOpportunity: { findMany: (...a: unknown[]) => findManyOpportunities(...a) },
    ptaVolunteerSlot: { findMany: (...a: unknown[]) => findManySlots(...a) },
    ptaVolunteerSignup: { findMany: (...a: unknown[]) => findManySignups(...a) },
    ptaVolunteerHourEntry: { findMany: (...a: unknown[]) => findManyEntries(...a) },
    user: { findMany: (...a: unknown[]) => findManyRecorders(...a) },
  },
}));

const resolveHouseholdRequirement = vi.fn();
vi.mock("../assignments", () => ({ resolveHouseholdRequirement: (...a: unknown[]) => resolveHouseholdRequirement(...a) }));

const getHouseholdLedgerTotals = vi.fn();
vi.mock("../ledger", () => ({ getHouseholdLedgerTotals: (...a: unknown[]) => getHouseholdLedgerTotals(...a) }));

const getVolunteerRequirementPeriod = vi.fn();
vi.mock("../periods", () => ({ getVolunteerRequirementPeriod: (...a: unknown[]) => getVolunteerRequirementPeriod(...a) }));

const resolveVolunteerBuyoutRate = vi.fn();
vi.mock("../pricing", () => ({ resolveVolunteerBuyoutRate: (...a: unknown[]) => resolveVolunteerBuyoutRate(...a) }));

beforeEach(() => {
  vi.clearAllMocks();
  getVolunteerRequirementPeriod.mockResolvedValue(PERIOD);
  resolveHouseholdRequirement.mockResolvedValue(REQUIREMENT);
  getHouseholdLedgerTotals.mockResolvedValue({
    verifiedMinutes: VERIFIED_MINUTES,
    eventMinutes: VERIFIED_MINUTES,
    nonEventMinutes: 0,
    pendingMinutes: 0,
    rejectedMinutes: 0,
    purchasedMinutes: PURCHASED_MINUTES,
    creditMinutes: 0,
    waivedMinutes: 0,
    assessmentChargeCents: ASSESSMENT_TOTAL_CENTS,
    paidElectronicCents: 0,
    paidOfflineCents: 0,
    refundedCents: 0,
    writtenOffCents: 0,
    outstandingBalanceCents: ASSESSMENT_TOTAL_CENTS,
  });
  findManyHouseholds.mockResolvedValue([HOUSEHOLD]);
  findUniqueHousehold.mockResolvedValue(HOUSEHOLD_WITH_CONTACT);
  findManyStudents.mockResolvedValue([{ displayName: "Alex Smith" }]);
  findManyPurchases.mockResolvedValue([
    { id: "purchase-1", householdId: "hh-1", baseAmountCents: PURCHASE_TOTAL_CENTS, coverageAmountCents: 0, refundedAmountCents: 0, status: "COMPLETED", electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: PURCHASED_MINUTES, rateType: "PER_HOUR", totalCents: PURCHASE_TOTAL_CENTS, paymentMethod: "STRIPE", recordedByUserId: null, completedAt: new Date("2026-10-01"), createdAt: new Date("2026-09-28") },
  ]);
  findManyCharges.mockResolvedValue([
    { id: "charge-1", organizationId: "org-1", householdId: "hh-1", amountCents: ASSESSMENT_TOTAL_CENTS, amountPaidCents: 0, refundedCents: 0, status: "PENDING", paymentMethod: null, recordedByUserId: null, paidAt: null, createdAt: new Date("2027-05-05"), line: { remainingMinutes: REMAINING_MINUTES } },
  ]);
  findFirstLedgerEntry.mockResolvedValue({ effectiveDate: new Date("2026-10-05") });
  findUniqueOrganization.mockResolvedValue({ name: "Lincoln Elementary PTA" });
  findUniqueOrgSettings.mockResolvedValue({ timezone: "America/Chicago" });
  findManyRecorders.mockResolvedValue([]);

  const OPPORTUNITY = { id: "opp-1", eventId: "event-1", event: { id: "event-1", title: "Fall Festival", startAt: new Date("2026-10-10"), location: "Gym", status: "PUBLISHED" } };
  findManyOpportunities.mockResolvedValue([OPPORTUNITY]);
  findManySlots.mockResolvedValue([{ id: "slot-1", opportunityId: "opp-1" }]);
  findManySignups.mockResolvedValue([{ slotId: "slot-1", status: "ATTENDED", householdId: "hh-1", householdAdultId: "adult-1" }]);
  findManyEntries.mockResolvedValue([
    { id: "entry-1", opportunityId: "opp-1", status: "APPROVED", creditedMinutes: VERIFIED_MINUTES, householdId: "hh-1", householdAdultId: "adult-1" },
  ]);
  // fix/pta-volunteer-reports-period-scope: this fixture's entry-1 IS the
  // pilot period's verified activity, so it's ledger-linked to period-1 —
  // matching every scenario's assumption that Report C's period-mode totals
  // still reflect it.
  findManyLedgerEntries.mockResolvedValue([{ sourceId: "entry-1" }]);
  resolveVolunteerBuyoutRate.mockImplementation((_org: string, _period: string, rateType: string) =>
    rateType === "FINAL_ASSESSMENT" ? Promise.resolve({ id: "window-final", amountCents: ASSESSMENT_RATE_CENTS_PER_HOUR, rateType: "FINAL_ASSESSMENT" }) : Promise.resolve(null)
  );
});

const filters = { requirementPeriodId: "period-1" };

describe("VH-L acceptance scenario 1 — family totals", () => {
  it("Report A computes remainingMinutes and completion consistently with the raw ledger totals", async () => {
    const { buildFamilySummaryReportData } = await import("../reports/family-summary");
    const data = await buildFamilySummaryReportData("org-1", filters, "Officer Jones", true);
    const row = data.rows[0];
    expect(row.verifiedMinutes).toBe(VERIFIED_MINUTES);
    expect(row.purchasedMinutes).toBe(PURCHASED_MINUTES);
    expect(row.remainingMinutes).toBe(REMAINING_MINUTES);
    expect(row.requirementStatus).toBe("ASSESSMENT_DUE");
  });
});

describe("VH-L acceptance scenario 2 — event report", () => {
  it("Report C attributes the household's verified event minutes to the correct event, matching Report A's event-minute figure", async () => {
    const { buildEventHoursReportData } = await import("../reports/event-hours");
    const data = await buildEventHoursReportData("org-1", filters, "Officer Jones");
    const eventRow = data.rows.find((r) => r.eventName === "Fall Festival")!;
    expect(eventRow.totalVerifiedMinutes).toBe(VERIFIED_MINUTES);
    expect(eventRow.familyCount).toBe(1);

    const { buildFamilySummaryReportData } = await import("../reports/family-summary");
    const familyData = await buildFamilySummaryReportData("org-1", filters, "Officer Jones", true);
    expect(familyData.rows[0].eventMinutes).toBe(eventRow.totalVerifiedMinutes);
  });
});

describe("VH-L acceptance scenario 3 — buyout math", () => {
  it("a partial buyout's total is exactly rate x hours, and Report A / Report E agree on the paid amount", async () => {
    expect(PURCHASE_TOTAL_CENTS).toBe(5_000);

    const { buildFamilySummaryReportData } = await import("../reports/family-summary");
    const familyData = await buildFamilySummaryReportData("org-1", filters, "Officer Jones", true);
    expect(familyData.rows[0].buyoutAmountPaidCents).toBe(PURCHASE_TOTAL_CENTS);

    const { buildFinancialReportData } = await import("../reports/financial");
    const financialData = await buildFinancialReportData("org-1", filters, "Treasurer Lee");
    const purchaseRow = financialData.rows.find((r) => r.transactionType === "BUYOUT_PURCHASE")!;
    expect(purchaseRow.amountPaidCents).toBe(PURCHASE_TOTAL_CENTS);
    expect(purchaseRow.hoursMinutes).toBe(PURCHASED_MINUTES);
  });
});

describe("VH-L acceptance scenario 4 — assessment math", () => {
  it("the assessment total is exactly remaining-hours x rate, and Report A / Report D (live estimate) / Report E (posted charge) all agree", async () => {
    expect(ASSESSMENT_TOTAL_CENTS).toBe(10_000);

    const { buildFamilySummaryReportData } = await import("../reports/family-summary");
    const familyData = await buildFamilySummaryReportData("org-1", filters, "Officer Jones", true);
    expect(familyData.rows[0].assessmentAmountCents).toBe(ASSESSMENT_TOTAL_CENTS);
    expect(familyData.rows[0].outstandingBalanceCents).toBe(ASSESSMENT_TOTAL_CENTS);

    const { buildComplianceReportData } = await import("../reports/compliance");
    const complianceData = await buildComplianceReportData("org-1", filters, "Officer Jones", true);
    expect(complianceData.rows[0].estimatedFinalAssessmentCents).toBe(ASSESSMENT_TOTAL_CENTS);
    expect(complianceData.rows[0].remainingMinutes).toBe(REMAINING_MINUTES);

    const { buildFinancialReportData } = await import("../reports/financial");
    const financialData = await buildFinancialReportData("org-1", filters, "Treasurer Lee");
    const chargeRow = financialData.rows.find((r) => r.transactionType === "ASSESSMENT_CHARGE")!;
    expect(chargeRow.totalAmountCents).toBe(ASSESSMENT_TOTAL_CENTS);
    expect(chargeRow.hoursMinutes).toBe(REMAINING_MINUTES);
  });
});

describe("VH-L acceptance scenarios — full chain, one fixture", () => {
  it("every report agrees: 10h required, 3h verified, 2h purchased ($50), 5h remaining assessed ($100)", async () => {
    const { buildFamilySummaryReportData } = await import("../reports/family-summary");
    const { buildEventHoursReportData } = await import("../reports/event-hours");
    const { buildComplianceReportData } = await import("../reports/compliance");
    const { buildFinancialReportData } = await import("../reports/financial");

    const [family, events, compliance, financial] = await Promise.all([
      buildFamilySummaryReportData("org-1", filters, "Officer Jones", true),
      buildEventHoursReportData("org-1", filters, "Officer Jones"),
      buildComplianceReportData("org-1", filters, "Officer Jones", true),
      buildFinancialReportData("org-1", filters, "Treasurer Lee"),
    ]);

    const familyRow = family.rows[0];
    const eventRow = events.rows[0];
    const complianceRow = compliance.rows[0];
    const purchaseRow = financial.rows.find((r) => r.transactionType === "BUYOUT_PURCHASE")!;
    const chargeRow = financial.rows.find((r) => r.transactionType === "ASSESSMENT_CHARGE")!;

    expect(familyRow.adjustedRequiredMinutes).toBe(REQUIRED_MINUTES);
    expect(familyRow.verifiedMinutes).toBe(eventRow.totalVerifiedMinutes);
    expect(familyRow.remainingMinutes).toBe(complianceRow.remainingMinutes);
    expect(familyRow.buyoutAmountPaidCents).toBe(purchaseRow.amountPaidCents);
    expect(familyRow.assessmentAmountCents).toBe(chargeRow.totalAmountCents);
    expect(complianceRow.estimatedFinalAssessmentCents).toBe(chargeRow.totalAmountCents);
  });
});
