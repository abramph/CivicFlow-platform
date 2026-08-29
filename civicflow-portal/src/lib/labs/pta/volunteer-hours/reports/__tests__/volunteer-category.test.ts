import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DetailActivityRow } from "../detail-activity";
import type { ReportData } from "../types";

const buildDetailActivityReportData = vi.fn();
vi.mock("../detail-activity", async () => {
  const actual = await vi.importActual<typeof import("../detail-activity")>("../detail-activity");
  return { ...actual, buildDetailActivityReportData: (...a: unknown[]) => buildDetailActivityReportData(...a) };
});

const findUniqueOrganization = vi.fn();
const findUniqueOrgSettings = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
  },
}));

const getVolunteerRequirementPeriod = vi.fn();
vi.mock("../../periods", () => ({ getVolunteerRequirementPeriod: (...a: unknown[]) => getVolunteerRequirementPeriod(...a) }));

function row(overrides: Partial<DetailActivityRow>): DetailActivityRow {
  return {
    householdAdultId: "adult-1",
    householdDisplayName: "The Smiths",
    volunteerName: "Jane Smith",
    relationship: "Parent",
    serviceDate: new Date("2026-10-05"),
    eventOrActivityName: "Fall Festival",
    eventId: "event-1",
    volunteerCategory: "EVENT_SERVICE",
    isEventBased: true,
    scheduledStart: null,
    scheduledEnd: null,
    reportedMinutes: 60,
    approvalStatus: "APPROVED",
    approvedByName: "Officer Jones",
    approvalDate: new Date("2026-10-05"),
    location: null,
    notes: null,
    source: "OFFICER_MANUAL",
    createdAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-10-05"),
    ...overrides,
  };
}

function detailFixture(rows: DetailActivityRow[]): ReportData<DetailActivityRow> {
  return {
    info: {
      organizationName: "Lincoln Elementary PTA",
      reportTitle: "Detailed Family Volunteer Activity",
      requirementPeriodName: "2026-2027 School Year",
      coveredDateRange: "2026-08-01 to 2027-06-01",
      appliedFilters: {},
      generatedAt: new Date(),
      organizationTimezone: "America/Chicago",
      generatedByName: "Officer Jones",
      calculationNotes: [],
    },
    summary: {
      totalFamilies: 0,
      totalIndividualVolunteers: 0,
      totalVerifiedMinutes: 0,
      totalEventMinutes: 0,
      totalNonEventMinutes: 0,
      totalPendingMinutes: 0,
      totalPurchasedMinutes: 0,
      totalWaivedMinutes: 0,
      totalRemainingMinutes: 0,
      familiesMeetingRequirement: 0,
      familiesNotMeetingRequirement: 0,
      familiesExempt: 0,
      totalBuyoutRevenueCents: 0,
      totalAssessmentsCents: 0,
      outstandingBalanceCents: 0,
    },
    rows,
  };
}

const filters = { requirementPeriodId: "period-1" };

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrganization.mockResolvedValue({ name: "Lincoln Elementary PTA" });
  findUniqueOrgSettings.mockResolvedValue({ timezone: "America/Chicago" });
  getVolunteerRequirementPeriod.mockResolvedValue({
    id: "period-1",
    name: "2026-2027 School Year",
    startsOn: new Date("2026-08-01"),
    endsOn: new Date("2027-06-01"),
    timezone: "America/Chicago",
  });
});

describe("buildVolunteerCategoryReportData — Report G", () => {
  it("aggregates verified/pending/rejected minutes per category across all volunteers", async () => {
    buildDetailActivityReportData.mockResolvedValue(
      detailFixture([
        row({ householdAdultId: "adult-1", volunteerCategory: "EVENT_SERVICE", approvalStatus: "APPROVED", reportedMinutes: 60, isEventBased: true }),
        row({ householdAdultId: "adult-2", volunteerCategory: "EVENT_SERVICE", approvalStatus: "APPROVED", reportedMinutes: 30, isEventBased: true }),
        row({ householdAdultId: "adult-1", volunteerCategory: "EVENT_SERVICE", approvalStatus: "PENDING", reportedMinutes: 15 }),
        row({ householdAdultId: "adult-3", volunteerCategory: "AT_HOME_SERVICE", approvalStatus: "REJECTED", reportedMinutes: 20 }),
      ])
    );
    const { buildVolunteerCategoryReportData } = await import("../volunteer-category");
    const data = await buildVolunteerCategoryReportData("org-1", filters, "Officer Jones");

    const eventRow = data.rows.find((r) => r.category === "EVENT_SERVICE")!;
    expect(eventRow.verifiedMinutes).toBe(90);
    expect(eventRow.pendingMinutes).toBe(15);
    expect(eventRow.uniqueVolunteers).toBe(2);
    expect(eventRow.uniqueFamilies).toBe(1);
    expect(eventRow.entryCount).toBe(3);

    const homeRow = data.rows.find((r) => r.category === "AT_HOME_SERVICE")!;
    expect(homeRow.rejectedMinutes).toBe(20);
    expect(homeRow.verifiedMinutes).toBe(0);
  });

  it("groups uncategorized legacy entries under UNCATEGORIZED rather than dropping them", async () => {
    buildDetailActivityReportData.mockResolvedValue(detailFixture([row({ volunteerCategory: null })]));
    const { buildVolunteerCategoryReportData } = await import("../volunteer-category");
    const data = await buildVolunteerCategoryReportData("org-1", filters, "Officer Jones");
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].category).toBe("UNCATEGORIZED");
  });

  it("sorts categories by verified minutes descending", async () => {
    buildDetailActivityReportData.mockResolvedValue(
      detailFixture([
        row({ volunteerCategory: "AT_HOME_SERVICE", reportedMinutes: 10 }),
        row({ volunteerCategory: "EVENT_SERVICE", reportedMinutes: 100 }),
      ])
    );
    const { buildVolunteerCategoryReportData } = await import("../volunteer-category");
    const data = await buildVolunteerCategoryReportData("org-1", filters, "Officer Jones");
    expect(data.rows[0].category).toBe("EVENT_SERVICE");
    expect(data.rows[1].category).toBe("AT_HOME_SERVICE");
  });

  it("VOLUNTEER_CATEGORY_COLUMNS.getValue reads the exact fields present on the row", async () => {
    buildDetailActivityReportData.mockResolvedValue(detailFixture([row({})]));
    const { buildVolunteerCategoryReportData, VOLUNTEER_CATEGORY_COLUMNS } = await import("../volunteer-category");
    const data = await buildVolunteerCategoryReportData("org-1", filters, "Officer Jones");
    for (const col of VOLUNTEER_CATEGORY_COLUMNS) {
      expect(() => col.getValue(data.rows[0])).not.toThrow();
    }
  });

  describe("period scoping (fix/pta-volunteer-reports-period-scope)", () => {
    it("passes filters (including mode) through to Report B unchanged — never re-queries raw activity itself", async () => {
      buildDetailActivityReportData.mockResolvedValue(detailFixture([row({})]));
      const { buildVolunteerCategoryReportData } = await import("../volunteer-category");
      const scopedFilters = { ...filters, mode: "ALL_TIME" as const };
      await buildVolunteerCategoryReportData("org-1", scopedFilters, "Officer Jones");
      expect(buildDetailActivityReportData).toHaveBeenCalledWith("org-1", scopedFilters, "Officer Jones");
    });

    it("totals equal Report B's applicable per-category totals — cannot diverge since it aggregates B's own already-period-filtered rows", async () => {
      buildDetailActivityReportData.mockResolvedValue(
        detailFixture([
          row({ volunteerCategory: "EVENT_SERVICE", reportedMinutes: 60, isEventBased: true }),
          row({ volunteerCategory: "EVENT_SERVICE", reportedMinutes: 30, isEventBased: true }),
        ])
      );
      const { buildVolunteerCategoryReportData } = await import("../volunteer-category");
      const data = await buildVolunteerCategoryReportData("org-1", filters, "Officer Jones");
      expect(data.summary.totalVerifiedMinutes).toBe(90);
    });

    it("labels the report All-Time only when ALL_TIME mode is explicitly requested", async () => {
      buildDetailActivityReportData.mockResolvedValue(detailFixture([row({})]));
      const { buildVolunteerCategoryReportData } = await import("../volunteer-category");
      const periodData = await buildVolunteerCategoryReportData("org-1", filters, "Officer Jones");
      expect(periodData.info.reportTitle).toBe("Volunteer Category Report");

      const allTimeData = await buildVolunteerCategoryReportData("org-1", { ...filters, mode: "ALL_TIME" }, "Officer Jones");
      expect(allTimeData.info.reportTitle).toBe("Volunteer Category Report (All-Time)");
    });
  });
});
