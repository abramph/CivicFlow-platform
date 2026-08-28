import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyEntries = vi.fn();
const findManyOpportunities = vi.fn();
const findManySlots = vi.fn();
const findManyAdults = vi.fn();
const findManyHouseholdsById = vi.fn();
const findManyUsers = vi.fn();
const findManyActiveHouseholds = vi.fn();
const findUniqueOrganization = vi.fn();
const findUniqueOrgSettings = vi.fn();
const findFirstPeriod = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerHourEntry: { findMany: (...a: unknown[]) => findManyEntries(...a) },
    ptaVolunteerOpportunity: { findMany: (...a: unknown[]) => findManyOpportunities(...a) },
    ptaVolunteerSlot: { findMany: (...a: unknown[]) => findManySlots(...a) },
    ptaHouseholdAdult: { findMany: (...a: unknown[]) => findManyAdults(...a) },
    ptaHousehold: {
      findMany: (args: unknown) => (isActiveHouseholdQuery(args) ? findManyActiveHouseholds(args) : findManyHouseholdsById(args)),
      findFirst: vi.fn(),
    },
    user: { findMany: (...a: unknown[]) => findManyUsers(...a) },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    ptaVolunteerRequirementPeriod: { findFirst: (...a: unknown[]) => findFirstPeriod(...a) },
  },
}));

function isActiveHouseholdQuery(args: unknown): boolean {
  const where = (args as { where?: { status?: string } })?.where;
  return where?.status === "ACTIVE";
}

const OPPORTUNITY = { id: "opp-1", title: "Fall Festival Setup", eventId: "event-1" };
const SLOT = { id: "slot-1", startAt: new Date("2026-10-10T09:00:00Z"), endAt: new Date("2026-10-10T12:00:00Z"), locationOverride: "Gym" };
const ADULT = { id: "adult-1", name: "Jane Smith", relationshipLabel: "Parent" };
const HOUSEHOLD = { id: "hh-1", displayName: "The Smiths" };
const APPROVER = { id: "user-1", displayName: "Officer Jones", email: "officer@example.com" };

const ENTRY = {
  id: "entry-1",
  organizationId: "org-1",
  householdId: "hh-1",
  householdAdultId: "adult-1",
  opportunityId: "opp-1",
  slotId: "slot-1",
  category: "EVENT_SERVICE",
  creditedMinutes: 120,
  status: "APPROVED",
  notes: "Great job",
  source: "MANUAL",
  approvedByUserId: "user-1",
  approvedAt: new Date("2026-10-05T00:00:00Z"),
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-05T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  findManyEntries.mockResolvedValue([ENTRY]);
  findManyOpportunities.mockResolvedValue([OPPORTUNITY]);
  findManySlots.mockResolvedValue([SLOT]);
  findManyAdults.mockResolvedValue([ADULT]);
  findManyHouseholdsById.mockResolvedValue([HOUSEHOLD]);
  findManyActiveHouseholds.mockResolvedValue([HOUSEHOLD]);
  findManyUsers.mockResolvedValue([APPROVER]);
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

const filters = { requirementPeriodId: "period-1", householdId: "hh-1" };

describe("buildDetailActivityReportData — Report B", () => {
  it("joins the raw hour entry to its opportunity/slot/adult/household/approver via manual batch fetches", async () => {
    const { buildDetailActivityReportData } = await import("../detail-activity");
    const data = await buildDetailActivityReportData("org-1", filters, "Officer Jones");

    expect(data.rows).toHaveLength(1);
    const row = data.rows[0];
    expect(row.householdDisplayName).toBe("The Smiths");
    expect(row.volunteerName).toBe("Jane Smith");
    expect(row.relationship).toBe("Parent");
    expect(row.eventOrActivityName).toBe("Fall Festival Setup");
    expect(row.isEventBased).toBe(true);
    expect(row.reportedMinutes).toBe(120);
    expect(row.approvalStatus).toBe("APPROVED");
    expect(row.approvedByName).toBe("Officer Jones");
    expect(row.location).toBe("Gym");
    expect(data.summary.totalVerifiedMinutes).toBe(120);
    expect(data.summary.totalEventMinutes).toBe(120);
  });

  it("excludes an entry whose opportunity does not match the eventId filter", async () => {
    const { buildDetailActivityReportData } = await import("../detail-activity");
    const data = await buildDetailActivityReportData("org-1", { ...filters, eventId: "some-other-event" }, "Officer Jones");
    expect(data.rows).toHaveLength(0);
  });

  it("excludes an entry whose service date falls outside the requested date range", async () => {
    const { buildDetailActivityReportData } = await import("../detail-activity");
    const data = await buildDetailActivityReportData(
      "org-1",
      { ...filters, dateRangeStart: new Date("2026-11-01"), dateRangeEnd: new Date("2026-12-01") },
      "Officer Jones"
    );
    expect(data.rows).toHaveLength(0);
  });

  it("counts non-event categories toward non-event minutes, not event minutes", async () => {
    findManyEntries.mockResolvedValue([{ ...ENTRY, category: "AT_HOME_SERVICE" }]);
    findManyOpportunities.mockResolvedValue([{ ...OPPORTUNITY, eventId: null }]);
    const { buildDetailActivityReportData } = await import("../detail-activity");
    const data = await buildDetailActivityReportData("org-1", filters, "Officer Jones");
    expect(data.rows[0].isEventBased).toBe(false);
    expect(data.summary.totalNonEventMinutes).toBe(120);
    expect(data.summary.totalEventMinutes).toBe(0);
  });

  it("DETAIL_ACTIVITY_COLUMNS.getValue reads the exact fields present on the row", async () => {
    const { buildDetailActivityReportData, DETAIL_ACTIVITY_COLUMNS } = await import("../detail-activity");
    const data = await buildDetailActivityReportData("org-1", filters, "Officer Jones");
    const row = data.rows[0];
    for (const col of DETAIL_ACTIVITY_COLUMNS) {
      expect(() => col.getValue(row)).not.toThrow();
    }
  });
});
