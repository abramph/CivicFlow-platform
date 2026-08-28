import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyHouseholds = vi.fn();
const findUniqueOrganization = vi.fn();
const findUniqueOrgSettings = vi.fn();
const findFirstPeriod = vi.fn();
const findManyPurchases = vi.fn();
const findManyCharges = vi.fn();
const findManyEmpty = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHousehold: { findMany: (...a: unknown[]) => findManyHouseholds(...a), findFirst: vi.fn(), findUnique: vi.fn() },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    ptaVolunteerRequirementPeriod: { findFirst: (...a: unknown[]) => findFirstPeriod(...a) },
    ptaVolunteerBuyoutPurchase: { findMany: (...a: unknown[]) => findManyPurchases(...a) },
    ptaVolunteerAssessmentCharge: { findMany: (...a: unknown[]) => findManyCharges(...a) },
    ptaVolunteerHourEntry: { findMany: (...a: unknown[]) => findManyEmpty(...a) },
    ptaVolunteerOpportunity: { findMany: (...a: unknown[]) => findManyEmpty(...a) },
    ptaVolunteerSlot: { findMany: (...a: unknown[]) => findManyEmpty(...a) },
    ptaVolunteerSignup: { findMany: (...a: unknown[]) => findManyEmpty(...a) },
    ptaHouseholdAdult: { findMany: (...a: unknown[]) => findManyEmpty(...a) },
    user: { findMany: (...a: unknown[]) => findManyEmpty(...a) },
    ptaStudent: { findMany: (...a: unknown[]) => findManyEmpty(...a) },
    ptaVolunteerLedgerEntry: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

const resolveHouseholdRequirement = vi.fn();
vi.mock("../../assignments", () => ({ resolveHouseholdRequirement: (...a: unknown[]) => resolveHouseholdRequirement(...a) }));

const getHouseholdLedgerTotals = vi.fn();
vi.mock("../../ledger", () => ({ getHouseholdLedgerTotals: (...a: unknown[]) => getHouseholdLedgerTotals(...a) }));

vi.mock("../../pricing", () => ({ resolveVolunteerBuyoutRate: vi.fn().mockResolvedValue(null) }));

beforeEach(() => {
  vi.clearAllMocks();
  findManyHouseholds.mockResolvedValue([]);
  findManyPurchases.mockResolvedValue([]);
  findManyCharges.mockResolvedValue([]);
  findUniqueOrganization.mockResolvedValue({ name: "Lincoln Elementary PTA" });
  findUniqueOrgSettings.mockResolvedValue({ timezone: "America/Chicago" });
  findFirstPeriod.mockResolvedValue({
    id: "period-1",
    name: "2026-2027 School Year",
    startsOn: new Date("2026-08-01"),
    endsOn: new Date("2027-06-01"),
    timezone: "America/Chicago",
    requiredMinutesDefault: 600,
    volunteerDeadline: null,
  });
  resolveHouseholdRequirement.mockResolvedValue({
    requiredMinutes: 600,
    assignmentType: "STANDARD",
    matchedScopeType: null,
    assignmentId: null,
    reason: null,
    exempt: false,
  });
  getHouseholdLedgerTotals.mockResolvedValue({
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
  });
});

describe("isVolunteerReportType", () => {
  it("recognizes every one of this program's 7 report types", async () => {
    const { isVolunteerReportType, VOLUNTEER_REPORT_TYPES } = await import("../dispatch");
    for (const type of VOLUNTEER_REPORT_TYPES) {
      expect(isVolunteerReportType(type)).toBe(true);
    }
  });

  it("rejects report types belonging to other verticals — never lets another vertical's export be mistaken for a volunteer-hours one", async () => {
    const { isVolunteerReportType } = await import("../dispatch");
    expect(isVolunteerReportType("MEMBERS")).toBe(false);
    expect(isVolunteerReportType("DUES")).toBe(false);
    expect(isVolunteerReportType("")).toBe(false);
  });
});

describe("permissionForVolunteerReportType", () => {
  it("gates Report E (financial) behind the stricter financial-reports permission", async () => {
    const { permissionForVolunteerReportType } = await import("../dispatch");
    expect(permissionForVolunteerReportType("PTA_VOLUNTEER_FINANCIAL")).toBe("pta:volunteer-financial-reports:view");
  });

  it("gates every other report behind the general reports permission", async () => {
    const { permissionForVolunteerReportType, VOLUNTEER_REPORT_TYPES } = await import("../dispatch");
    for (const type of VOLUNTEER_REPORT_TYPES) {
      if (type === "PTA_VOLUNTEER_FINANCIAL") continue;
      expect(permissionForVolunteerReportType(type)).toBe("pta:volunteer-reports:view");
    }
  });
});

describe("buildVolunteerReportExportFile", () => {
  it("builds a real .xlsx buffer and a filename for every one of the 7 report types", async () => {
    const { buildVolunteerReportExportFile, VOLUNTEER_REPORT_TYPES } = await import("../dispatch");
    for (const type of VOLUNTEER_REPORT_TYPES) {
      const { buffer, filename } = await buildVolunteerReportExportFile("org-1", type, { requirementPeriodId: "period-1" }, "Officer Jones");
      expect(buffer.byteLength).toBeGreaterThan(0);
      expect(filename).toMatch(/\.xlsx$/);
    }
  });
});
