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
const findManyLedgerEntries = vi.fn();

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
    ptaVolunteerLedgerEntry: { findMany: (...a: unknown[]) => findManyLedgerEntries(...a) },
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
  // Default: the fixture entry IS ledger-linked to period-1 — matches every
  // pre-existing test's assumption that PERIOD mode (the default) includes it.
  findManyLedgerEntries.mockResolvedValue([{ sourceId: "entry-1" }]);
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

  describe("period scoping (fix/pta-volunteer-reports-period-scope)", () => {
    it("PERIOD mode (the default, no mode specified) excludes an entry with no ledger relationship to any period", async () => {
      findManyLedgerEntries.mockResolvedValue([]); // no ledger row at all for entry-1
      const { buildDetailActivityReportData } = await import("../detail-activity");
      const data = await buildDetailActivityReportData("org-1", filters, "Officer Jones");
      expect(data.rows).toHaveLength(0);
      expect(data.summary.totalVerifiedMinutes).toBe(0);
    });

    it("PERIOD mode excludes an entry ledger-linked to a DIFFERENT period than the one selected", async () => {
      // resolvePeriodLinkedHourEntryIds queries ptaVolunteerLedgerEntry scoped
      // to requirementPeriodId: filters.requirementPeriodId — a real Prisma
      // call with that where-clause would never return a different-period
      // row, so the mock returning [] here is the correct simulation of
      // "this entry's ledger row belongs to another period."
      findManyLedgerEntries.mockResolvedValue([]);
      const { buildDetailActivityReportData } = await import("../detail-activity");
      const data = await buildDetailActivityReportData("org-1", { ...filters, requirementPeriodId: "period-1" }, "Officer Jones");
      expect(data.rows).toHaveLength(0);
    });

    it("does not infer period membership merely because the entry belongs to the same household", async () => {
      findManyLedgerEntries.mockResolvedValue([]);
      const { buildDetailActivityReportData } = await import("../detail-activity");
      const data = await buildDetailActivityReportData("org-1", filters, "Officer Jones");
      expect(data.rows).toHaveLength(0);
    });

    it("ALL_TIME mode (explicit opt-in) includes an entry with no period relationship at all", async () => {
      findManyLedgerEntries.mockResolvedValue([]); // still no ledger row
      const { buildDetailActivityReportData } = await import("../detail-activity");
      const data = await buildDetailActivityReportData("org-1", { ...filters, mode: "ALL_TIME" }, "Officer Jones");
      expect(data.rows).toHaveLength(1);
      expect(data.info.reportTitle).toBe("All-Time Volunteer Activity");
      expect(data.info.calculationNotes.some((n) => n.startsWith("ALL-TIME MODE"))).toBe(true);
    });

    it("mode defaults to PERIOD when unset — ALL_TIME is never the default when a period ID is supplied", async () => {
      findManyLedgerEntries.mockResolvedValue([{ sourceId: "entry-1" }]);
      const { buildDetailActivityReportData } = await import("../detail-activity");
      const data = await buildDetailActivityReportData("org-1", filters, "Officer Jones");
      expect(data.info.reportTitle).toBe("Detailed Family Volunteer Activity");
      expect(data.info.calculationNotes.some((n) => n.startsWith("ALL-TIME MODE"))).toBe(false);
    });

    it("queries the ledger scoped to the exact organization and selected period, not merely the household", async () => {
      const { buildDetailActivityReportData } = await import("../detail-activity");
      await buildDetailActivityReportData("org-1", filters, "Officer Jones");
      expect(findManyLedgerEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: "org-1",
            requirementPeriodId: "period-1",
            sourceType: "hourEntry",
          }),
        })
      );
    });
  });
});
