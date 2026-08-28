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

describe("buildIndividualVolunteerReportData — Report F", () => {
  it("aggregates a volunteer's multiple approved entries into one row", async () => {
    buildDetailActivityReportData.mockResolvedValue(
      detailFixture([
        row({ reportedMinutes: 60, isEventBased: true, volunteerCategory: "EVENT_SERVICE", serviceDate: new Date("2026-10-05") }),
        row({ reportedMinutes: 90, isEventBased: false, volunteerCategory: "AT_HOME_SERVICE", serviceDate: new Date("2026-11-01") }),
      ])
    );
    const { buildIndividualVolunteerReportData } = await import("../individual-volunteer");
    const data = await buildIndividualVolunteerReportData("org-1", filters, "Officer Jones");

    expect(data.rows).toHaveLength(1);
    const r = data.rows[0];
    expect(r.verifiedMinutes).toBe(150);
    expect(r.eventMinutes).toBe(60);
    expect(r.nonEventMinutes).toBe(90);
    expect(r.entryCount).toBe(2);
    expect(r.categoriesServed).toBe("AT_HOME_SERVICE, EVENT_SERVICE");
    expect(r.firstServiceDate).toEqual(new Date("2026-10-05"));
    expect(r.lastServiceDate).toEqual(new Date("2026-11-01"));
  });

  it("keeps separate volunteers as separate rows", async () => {
    buildDetailActivityReportData.mockResolvedValue(
      detailFixture([row({ householdAdultId: "adult-1" }), row({ householdAdultId: "adult-2", volunteerName: "John Doe" })])
    );
    const { buildIndividualVolunteerReportData } = await import("../individual-volunteer");
    const data = await buildIndividualVolunteerReportData("org-1", filters, "Officer Jones");
    expect(data.rows).toHaveLength(2);
  });

  it("counts pending minutes separately without adding them to verified", async () => {
    buildDetailActivityReportData.mockResolvedValue(detailFixture([row({ approvalStatus: "PENDING", reportedMinutes: 45 })]));
    const { buildIndividualVolunteerReportData } = await import("../individual-volunteer");
    const data = await buildIndividualVolunteerReportData("org-1", filters, "Officer Jones");
    expect(data.rows[0].verifiedMinutes).toBe(0);
    expect(data.rows[0].pendingMinutes).toBe(45);
  });

  it("excludes a volunteer whose only entries are rejected", async () => {
    buildDetailActivityReportData.mockResolvedValue(detailFixture([row({ approvalStatus: "REJECTED" })]));
    const { buildIndividualVolunteerReportData } = await import("../individual-volunteer");
    const data = await buildIndividualVolunteerReportData("org-1", filters, "Officer Jones");
    expect(data.rows).toHaveLength(0);
  });

  it("INDIVIDUAL_VOLUNTEER_COLUMNS.getValue reads the exact fields present on the row", async () => {
    buildDetailActivityReportData.mockResolvedValue(detailFixture([row({})]));
    const { buildIndividualVolunteerReportData, INDIVIDUAL_VOLUNTEER_COLUMNS } = await import("../individual-volunteer");
    const data = await buildIndividualVolunteerReportData("org-1", filters, "Officer Jones");
    for (const col of INDIVIDUAL_VOLUNTEER_COLUMNS) {
      expect(() => col.getValue(data.rows[0])).not.toThrow();
    }
  });
});
