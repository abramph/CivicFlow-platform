import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyOpportunities = vi.fn();
const findManySlots = vi.fn();
const findManySignups = vi.fn();
const findManyEntries = vi.fn();
const findUniqueOrganization = vi.fn();
const findUniqueOrgSettings = vi.fn();
const findFirstPeriod = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerOpportunity: { findMany: (...a: unknown[]) => findManyOpportunities(...a) },
    ptaVolunteerSlot: { findMany: (...a: unknown[]) => findManySlots(...a) },
    ptaVolunteerSignup: { findMany: (...a: unknown[]) => findManySignups(...a) },
    ptaVolunteerHourEntry: { findMany: (...a: unknown[]) => findManyEntries(...a) },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    ptaVolunteerRequirementPeriod: { findFirst: (...a: unknown[]) => findFirstPeriod(...a) },
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
    { opportunityId: "opp-1", status: "APPROVED", creditedMinutes: 120, householdId: "hh-1", householdAdultId: "adult-1" },
    { opportunityId: "opp-2", status: "PENDING", creditedMinutes: 60, householdId: "hh-3", householdAdultId: "adult-3" },
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
});
