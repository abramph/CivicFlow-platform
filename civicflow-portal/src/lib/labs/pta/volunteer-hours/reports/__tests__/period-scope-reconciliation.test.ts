import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * fix/pta-volunteer-reports-period-scope — end-to-end reconciliation fixture.
 * Exercises the REAL (unmocked) Report B, F, and G build functions together
 * against one shared 12-scenario fixture, proving their totals cannot
 * diverge from each other in requirement-period mode — the exact guarantee
 * the pre-fix bug violated (B/F/G showed 4,740 min where the ledger/A/D
 * showed 2,760 for the Pine Grove pilot).
 */

const findManyEntries = vi.fn();
const findManyOpportunities = vi.fn();
const findManySlots = vi.fn();
const findManyAdults = vi.fn();
const findManyHouseholdsById = vi.fn();
const findManyUsers = vi.fn();
const findUniqueOrganization = vi.fn();
const findUniqueOrgSettings = vi.fn();
const findFirstPeriod = vi.fn();
const findManyLedgerEntries = vi.fn();
const findManyActiveHouseholds = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerHourEntry: { findMany: (...a: unknown[]) => findManyEntries(...a) },
    ptaVolunteerOpportunity: { findMany: (...a: unknown[]) => findManyOpportunities(...a) },
    ptaVolunteerSlot: { findMany: (...a: unknown[]) => findManySlots(...a) },
    ptaHouseholdAdult: { findMany: (...a: unknown[]) => findManyAdults(...a) },
    ptaHousehold: {
      findMany: (args: { where?: { status?: string } }) =>
        args?.where?.status === "ACTIVE" ? findManyActiveHouseholds(args) : findManyHouseholdsById(args),
      findFirst: vi.fn(),
    },
    user: { findMany: (...a: unknown[]) => findManyUsers(...a) },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    ptaVolunteerRequirementPeriod: { findFirst: (...a: unknown[]) => findFirstPeriod(...a) },
    ptaVolunteerLedgerEntry: { findMany: (...a: unknown[]) => findManyLedgerEntries(...a) },
  },
}));

const ORG = "org-1";
const PERIOD = "period-1";
const OTHER_PERIOD = "period-2";
const HOUSEHOLD = { id: "hh-1", displayName: "The Smiths" };
const OTHER_HOUSEHOLD = { id: "hh-2", displayName: "The Joneses" };
const ADULT = { id: "adult-1", name: "Jane Smith", relationshipLabel: "Parent" };
const OTHER_ADULT = { id: "adult-2", name: "Sam Jones", relationshipLabel: "Parent" };
const EVENT_OPP = { id: "opp-event", title: "Fall Festival", eventId: "event-1" };
const NON_EVENT_OPP = { id: "opp-non-event", title: "At-Home Service", eventId: null };
const SLOT = { id: "slot-1", startAt: new Date("2026-10-10"), endAt: new Date("2026-10-10"), locationOverride: null };

// The 12-scenario fixture matrix (section 10 of the correction authorization).
const ENTRIES = [
  { id: "he-approved-event", householdId: "hh-1", householdAdultId: "adult-1", opportunityId: "opp-event", slotId: "slot-1", category: "EVENT_SERVICE", creditedMinutes: 60, status: "APPROVED", source: "OFFICER_MANUAL", notes: null, approvedByUserId: null, approvedAt: null, createdAt: new Date("2026-09-01"), updatedAt: new Date("2026-09-01") },
  { id: "he-approved-non-event", householdId: "hh-1", householdAdultId: "adult-1", opportunityId: "opp-non-event", slotId: "slot-1", category: "AT_HOME_SERVICE", creditedMinutes: 90, status: "APPROVED", source: "OFFICER_MANUAL", notes: null, approvedByUserId: null, approvedAt: null, createdAt: new Date("2026-09-02"), updatedAt: new Date("2026-09-02") },
  { id: "he-pending", householdId: "hh-1", householdAdultId: "adult-1", opportunityId: "opp-non-event", slotId: "slot-1", category: "AT_HOME_SERVICE", creditedMinutes: 30, status: "PENDING", source: "OFFICER_MANUAL", notes: null, approvedByUserId: null, approvedAt: null, createdAt: new Date("2026-09-03"), updatedAt: new Date("2026-09-03") },
  { id: "he-rejected", householdId: "hh-1", householdAdultId: "adult-1", opportunityId: "opp-non-event", slotId: "slot-1", category: "AT_HOME_SERVICE", creditedMinutes: 45, status: "REJECTED", source: "OFFICER_MANUAL", notes: null, approvedByUserId: null, approvedAt: null, createdAt: new Date("2026-09-04"), updatedAt: new Date("2026-09-04") },
  { id: "he-legacy-pre-period", householdId: "hh-1", householdAdultId: "adult-1", opportunityId: "opp-non-event", slotId: "slot-1", category: null, creditedMinutes: 900, status: "APPROVED", source: "OFFICER_MANUAL", notes: null, approvedByUserId: null, approvedAt: null, createdAt: new Date("2026-07-01") /* before period starts */, updatedAt: new Date("2026-07-01") },
  { id: "he-another-period", householdId: "hh-1", householdAdultId: "adult-1", opportunityId: "opp-non-event", slotId: "slot-1", category: null, creditedMinutes: 120, status: "APPROVED", source: "OFFICER_MANUAL", notes: null, approvedByUserId: null, approvedAt: null, createdAt: new Date("2026-09-05"), updatedAt: new Date("2026-09-05") },
  { id: "he-other-household", householdId: "hh-2", householdAdultId: "adult-2", opportunityId: "opp-non-event", slotId: "slot-1", category: null, creditedMinutes: 200, status: "APPROVED", source: "OFFICER_MANUAL", notes: null, approvedByUserId: null, approvedAt: null, createdAt: new Date("2026-09-06"), updatedAt: new Date("2026-09-06") },
];

// Ledger mirror: only entries actually processed under PERIOD get a row for
// PERIOD. he-another-period is linked to OTHER_PERIOD instead (not PERIOD).
// he-legacy-pre-period has NO ledger row at all (never processed under any
// period — genuine pre-Requirements-feature legacy activity).
const LEDGER_ROWS = [
  { sourceId: "he-approved-event", requirementPeriodId: PERIOD },
  { sourceId: "he-approved-non-event", requirementPeriodId: PERIOD },
  { sourceId: "he-pending", requirementPeriodId: PERIOD },
  { sourceId: "he-rejected", requirementPeriodId: PERIOD },
  { sourceId: "he-another-period", requirementPeriodId: OTHER_PERIOD },
  { sourceId: "he-other-household", requirementPeriodId: PERIOD },
];

beforeEach(() => {
  vi.clearAllMocks();
  findManyOpportunities.mockResolvedValue([EVENT_OPP, NON_EVENT_OPP]);
  findManySlots.mockResolvedValue([SLOT]);
  findManyAdults.mockResolvedValue([ADULT, OTHER_ADULT]);
  findManyHouseholdsById.mockResolvedValue([HOUSEHOLD, OTHER_HOUSEHOLD]);
  findManyActiveHouseholds.mockResolvedValue([HOUSEHOLD, OTHER_HOUSEHOLD]);
  findManyUsers.mockResolvedValue([]);
  findUniqueOrganization.mockResolvedValue({ name: "Lincoln Elementary PTA" });
  findUniqueOrgSettings.mockResolvedValue({ timezone: "America/Chicago" });
  findFirstPeriod.mockResolvedValue({
    id: PERIOD,
    name: "2026-2027 School Year",
    startsOn: new Date("2026-08-01"),
    endsOn: new Date("2027-06-01"),
    timezone: "America/Chicago",
  });
  findManyEntries.mockImplementation(async (args: { where?: { householdId?: { in: string[] } } }) => {
    const householdIds = args?.where?.householdId?.in;
    return householdIds ? ENTRIES.filter((e) => householdIds.includes(e.householdId)) : ENTRIES;
  });
  findManyLedgerEntries.mockImplementation(async (args: { where: { requirementPeriodId: string; sourceId: { in: string[] } } }) => {
    const { requirementPeriodId, sourceId } = args.where;
    return LEDGER_ROWS.filter((r) => r.requirementPeriodId === requirementPeriodId && sourceId.in.includes(r.sourceId));
  });
});

const filters = { requirementPeriodId: PERIOD, householdId: "hh-1" };

describe("Reports B/F/G reconciliation in requirement-period mode (default)", () => {
  it("Report B includes only the four in-period entries for hh-1 — excludes legacy, another-period, and another-household entries", async () => {
    const { buildDetailActivityReportData } = await import("../detail-activity");
    const data = await buildDetailActivityReportData(ORG, filters, "Officer Jones");
    const ids = data.rows.map((r) => r.householdAdultId + ":" + r.reportedMinutes).sort();
    expect(data.rows).toHaveLength(4);
    expect(data.summary.totalVerifiedMinutes).toBe(150); // 60 + 90
    expect(data.summary.totalEventMinutes).toBe(60);
    expect(data.summary.totalNonEventMinutes).toBe(90);
    expect(data.summary.totalPendingMinutes).toBe(30);
    // Rejected is tracked per-row but never folded into verified/pending totals.
    expect(data.rows.some((r) => r.approvalStatus === "REJECTED")).toBe(true);
    expect(ids).not.toContain("adult-1:900"); // legacy pre-period
    expect(ids).not.toContain("adult-1:120"); // another-period
    expect(ids).not.toContain("adult-2:200"); // another household (excluded by householdId filter)
  });

  it("Report F totals equal Report B's applicable per-volunteer totals (real, unmocked B)", async () => {
    const { buildIndividualVolunteerReportData } = await import("../individual-volunteer");
    const data = await buildIndividualVolunteerReportData(ORG, filters, "Officer Jones");
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].verifiedMinutes).toBe(150);
    expect(data.rows[0].pendingMinutes).toBe(30);
    expect(data.summary.totalVerifiedMinutes).toBe(150);
  });

  it("Report G totals equal Report B's applicable per-category totals (real, unmocked B)", async () => {
    const { buildVolunteerCategoryReportData } = await import("../volunteer-category");
    const data = await buildVolunteerCategoryReportData(ORG, filters, "Officer Jones");
    const totalVerified = data.rows.reduce((s, r) => s + r.verifiedMinutes, 0);
    const totalPending = data.rows.reduce((s, r) => s + r.pendingMinutes, 0);
    expect(totalVerified).toBe(150);
    expect(totalPending).toBe(30);
    expect(data.summary.totalVerifiedMinutes).toBe(150);
  });

  it("another-organization's data is never reachable — every query is organizationId-scoped by construction", async () => {
    const { buildDetailActivityReportData } = await import("../detail-activity");
    await buildDetailActivityReportData(ORG, filters, "Officer Jones");
    expect(findManyEntries).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) }));
    expect(findManyLedgerEntries).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) }));
  });
});

describe("ALL_TIME mode (explicit opt-in only) surfaces the full historical picture", () => {
  it("Report B in ALL_TIME mode includes the legacy and another-period entries the period-mode report excludes", async () => {
    const { buildDetailActivityReportData } = await import("../detail-activity");
    const data = await buildDetailActivityReportData(ORG, { ...filters, mode: "ALL_TIME" }, "Officer Jones");
    expect(data.rows).toHaveLength(6); // all hh-1 entries, still excludes hh-2 (different household filter)
    expect(data.summary.totalVerifiedMinutes).toBe(150 + 900 + 120); // 1170
    expect(data.info.reportTitle).toBe("All-Time Volunteer Activity");
  });

  it("does not default to ALL_TIME merely because a household has legacy activity — PERIOD stays the default", async () => {
    const { buildDetailActivityReportData } = await import("../detail-activity");
    const data = await buildDetailActivityReportData(ORG, filters, "Officer Jones");
    expect(data.info.reportTitle).toBe("Detailed Family Volunteer Activity");
    expect(data.summary.totalVerifiedMinutes).toBe(150);
  });
});
