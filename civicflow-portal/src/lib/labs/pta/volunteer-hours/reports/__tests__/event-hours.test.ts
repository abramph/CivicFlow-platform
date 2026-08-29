import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyOpportunities = vi.fn();
const findManySlots = vi.fn();
const findManySignups = vi.fn();
const findManyEntries = vi.fn();
const findUniqueOrganization = vi.fn();
const findUniqueOrgSettings = vi.fn();
const findFirstPeriod = vi.fn();
const findManyLedgerEntries = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerOpportunity: { findMany: (...a: unknown[]) => findManyOpportunities(...a) },
    ptaVolunteerSlot: { findMany: (...a: unknown[]) => findManySlots(...a) },
    ptaVolunteerSignup: { findMany: (...a: unknown[]) => findManySignups(...a) },
    ptaVolunteerHourEntry: { findMany: (...a: unknown[]) => findManyEntries(...a) },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    ptaVolunteerRequirementPeriod: { findFirst: (...a: unknown[]) => findFirstPeriod(...a) },
    ptaVolunteerLedgerEntry: { findMany: (...a: unknown[]) => findManyLedgerEntries(...a) },
  },
}));

const EVENT = { id: "event-1", title: "Fall Festival", startAt: new Date("2026-10-10T09:00:00Z"), location: "Main Field", status: "PUBLISHED" };
const OPPORTUNITIES = [
  { id: "opp-1", eventId: "event-1", event: EVENT },
  { id: "opp-2", eventId: "event-1", event: EVENT },
];
const SLOTS = [
  { id: "slot-1", opportunityId: "opp-1" },
  { id: "slot-2", opportunityId: "opp-2" },
];

beforeEach(() => {
  vi.clearAllMocks();
  findManyOpportunities.mockResolvedValue(OPPORTUNITIES);
  findManySlots.mockResolvedValue(SLOTS);
  findManySignups.mockResolvedValue([
    { slotId: "slot-1", status: "ATTENDED", householdId: "hh-1", householdAdultId: "adult-1" },
    { slotId: "slot-2", status: "NO_SHOW", householdId: "hh-2", householdAdultId: "adult-2" },
  ]);
  findManyEntries.mockResolvedValue([
    { id: "he-1", opportunityId: "opp-1", status: "APPROVED", creditedMinutes: 120, householdId: "hh-1", householdAdultId: "adult-1" },
    { id: "he-2", opportunityId: "opp-2", status: "PENDING", creditedMinutes: 60, householdId: "hh-3", householdAdultId: "adult-3" },
  ]);
  findUniqueOrganization.mockResolvedValue({ name: "Lincoln Elementary PTA" });
  findUniqueOrgSettings.mockResolvedValue({ timezone: "America/Chicago" });
  findFirstPeriod.mockResolvedValue({
    id: "period-1",
    name: "2026-2027 School Year",
    startsOn: new Date("2026-08-01"),
    endsOn: new Date("2027-06-01"),
    timezone: "America/Chicago",
  });
  // Default: both fixture entries ARE ledger-linked to period-1 — matches
  // every pre-existing test's assumption that PERIOD mode includes them.
  findManyLedgerEntries.mockResolvedValue([{ sourceId: "he-1" }, { sourceId: "he-2" }]);
});

const filters = { requirementPeriodId: "period-1" };

describe("buildEventHoursReportData — Report C", () => {
  it("attributes signups to an event via slotId -> opportunityId, since PtaVolunteerSignup has no opportunityId of its own", async () => {
    const { buildEventHoursReportData } = await import("../event-hours");
    const data = await buildEventHoursReportData("org-1", filters, "Officer Jones");

    expect(data.rows).toHaveLength(1);
    const row = data.rows[0];
    expect(row.eventName).toBe("Fall Festival");
    expect(row.opportunityCount).toBe(2);
    expect(row.signupCount).toBe(2);
    expect(row.attendedCount).toBe(1);
    expect(row.noShowCount).toBe(1);
    expect(row.familyCount).toBe(3);
    expect(row.individualVolunteerCount).toBe(3);
    expect(row.totalVerifiedMinutes).toBe(120);
    expect(row.totalPendingMinutes).toBe(60);
    expect(row.averageVerifiedMinutesPerVolunteer).toBe(40);
  });

  it("excludes an event whose startAt falls outside the requested date range", async () => {
    const { buildEventHoursReportData } = await import("../event-hours");
    const data = await buildEventHoursReportData(
      "org-1",
      { ...filters, dateRangeStart: new Date("2026-11-01"), dateRangeEnd: new Date("2026-12-01") },
      "Officer Jones"
    );
    expect(data.rows).toHaveLength(0);
  });

  it("excludes cancelled signups at the query level, never counting them toward attendance", async () => {
    const { buildEventHoursReportData } = await import("../event-hours");
    await buildEventHoursReportData("org-1", filters, "Officer Jones");
    expect(findManySignups).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { not: "CANCELLED" } }) }));
  });

  it("EVENT_HOURS_COLUMNS.getValue reads the exact fields present on the row", async () => {
    const { buildEventHoursReportData, EVENT_HOURS_COLUMNS } = await import("../event-hours");
    const data = await buildEventHoursReportData("org-1", filters, "Officer Jones");
    const row = data.rows[0];
    for (const col of EVENT_HOURS_COLUMNS) {
      expect(() => col.getValue(row)).not.toThrow();
    }
  });

  describe("period scoping (fix/pta-volunteer-reports-period-scope)", () => {
    it("PERIOD mode excludes credited hours from an entry not ledger-linked to the selected period, even though the event still shows", async () => {
      findManyLedgerEntries.mockResolvedValue([]); // neither entry is period-linked
      const { buildEventHoursReportData } = await import("../event-hours");
      const data = await buildEventHoursReportData("org-1", filters, "Officer Jones");
      expect(data.rows).toHaveLength(1);
      expect(data.rows[0].totalVerifiedMinutes).toBe(0);
      expect(data.rows[0].totalPendingMinutes).toBe(0);
      // an event associated with a household is not enough on its own —
      // attendance/signup counts (not "hours") are unaffected by this filter
      expect(data.rows[0].signupCount).toBe(2);
    });

    it("defaults the event date window to the selected period's own [startsOn, endsOn] when no explicit date filter is given", async () => {
      findFirstPeriod.mockResolvedValue({
        id: "period-1",
        name: "Narrow Period",
        startsOn: new Date("2027-01-01"),
        endsOn: new Date("2027-02-01"),
        timezone: "America/Chicago",
      });
      const { buildEventHoursReportData } = await import("../event-hours");
      // EVENT.startAt is 2026-10-10, outside the period's own window
      const data = await buildEventHoursReportData("org-1", filters, "Officer Jones");
      expect(data.rows).toHaveLength(0);
    });

    it("ALL_TIME mode (explicit opt-in) does not default the date window to the period and includes unlinked hours", async () => {
      findManyLedgerEntries.mockResolvedValue([]);
      findFirstPeriod.mockResolvedValue({
        id: "period-1",
        name: "Narrow Period",
        startsOn: new Date("2027-01-01"),
        endsOn: new Date("2027-02-01"),
        timezone: "America/Chicago",
      });
      const { buildEventHoursReportData } = await import("../event-hours");
      const data = await buildEventHoursReportData("org-1", { ...filters, mode: "ALL_TIME" }, "Officer Jones");
      expect(data.rows).toHaveLength(1);
      expect(data.rows[0].totalVerifiedMinutes).toBe(120);
      expect(data.info.calculationNotes.some((n) => n.startsWith("ALL-TIME MODE"))).toBe(true);
    });
  });

  describe("Report C six-scenario matrix (deploy authorization §4)", () => {
    it("1. in-period event with credited hours: appears, correct totals, event presence never implies hours were credited beyond what's actually linked", async () => {
      const { buildEventHoursReportData } = await import("../event-hours");
      const data = await buildEventHoursReportData("org-1", filters, "Officer Jones");
      expect(data.rows).toHaveLength(1);
      expect(data.rows[0].totalVerifiedMinutes).toBe(120);
      expect(data.rows[0].totalPendingMinutes).toBe(60);
    });

    it("2. in-period event with zero credited hours: still appears (event date alone is enough), with zero hour totals but real signup/attendance counts", async () => {
      findManyEntries.mockResolvedValue([]); // no hour entries at all for this event
      findManyLedgerEntries.mockResolvedValue([]);
      const { buildEventHoursReportData } = await import("../event-hours");
      const data = await buildEventHoursReportData("org-1", filters, "Officer Jones");
      expect(data.rows).toHaveLength(1);
      expect(data.rows[0].totalVerifiedMinutes).toBe(0);
      expect(data.rows[0].totalPendingMinutes).toBe(0);
      // signups still real and counted — presence of the event never implies hours were credited
      expect(data.rows[0].signupCount).toBe(2);
      expect(data.rows[0].attendedCount).toBe(1);
    });

    it("3. out-of-period event: does not appear at all", async () => {
      findFirstPeriod.mockResolvedValue({
        id: "period-1",
        name: "Narrow Period",
        startsOn: new Date("2020-01-01"),
        endsOn: new Date("2020-02-01"),
        timezone: "America/Chicago",
      });
      const { buildEventHoursReportData } = await import("../event-hours");
      const data = await buildEventHoursReportData("org-1", filters, "Officer Jones");
      expect(data.rows).toHaveLength(0);
    });

    it("4. in-period event containing an unlinked legacy entry: event appears, but the legacy entry's minutes are excluded from credited totals", async () => {
      findManyEntries.mockResolvedValue([
        { id: "he-legacy", opportunityId: "opp-1", status: "APPROVED", creditedMinutes: 900, householdId: "hh-legacy", householdAdultId: "adult-legacy" },
      ]);
      findManyLedgerEntries.mockResolvedValue([]); // he-legacy has no ledger row for period-1
      const { buildEventHoursReportData } = await import("../event-hours");
      const data = await buildEventHoursReportData("org-1", filters, "Officer Jones");
      expect(data.rows).toHaveLength(1);
      expect(data.rows[0].totalVerifiedMinutes).toBe(0); // legacy 900 min excluded
    });

    it("5. entry linked to another period: excluded from this period's credited totals", async () => {
      findManyEntries.mockResolvedValue([
        { id: "he-other-period", opportunityId: "opp-1", status: "APPROVED", creditedMinutes: 240, householdId: "hh-x", householdAdultId: "adult-x" },
      ]);
      // ledger row exists, but scoped to a DIFFERENT period than the one requested —
      // resolvePeriodLinkedHourEntryIds queries WHERE requirementPeriodId = filters.requirementPeriodId,
      // so a real Prisma call would never return this row for "period-1".
      findManyLedgerEntries.mockResolvedValue([]);
      const { buildEventHoursReportData } = await import("../event-hours");
      const data = await buildEventHoursReportData("org-1", { ...filters, requirementPeriodId: "period-1" }, "Officer Jones");
      expect(data.rows).toHaveLength(1);
      expect(data.rows[0].totalVerifiedMinutes).toBe(0);
    });

    it("6. cross-organization event: every underlying query is scoped to the exact requested organizationId", async () => {
      const { buildEventHoursReportData } = await import("../event-hours");
      await buildEventHoursReportData("org-1", filters, "Officer Jones");
      expect(findManyOpportunities).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) }));
      expect(findManyEntries).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) }));
      expect(findManyLedgerEntries).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1" }) }));
    });
  });
});
