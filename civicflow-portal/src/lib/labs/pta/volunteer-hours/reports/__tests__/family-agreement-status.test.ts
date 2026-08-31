import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyHouseholds = vi.fn();
const findUniqueOrganization = vi.fn();
const findUniqueOrgSettings = vi.fn();
const findFirstPeriod = vi.fn();
const findFirstAgreementVersion = vi.fn();
const findManyElections = vi.fn();
const findManyAcceptances = vi.fn();
const findManyDisputes = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHousehold: { findFirst: vi.fn(), findMany: (...a: unknown[]) => findManyHouseholds(...a) },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    ptaVolunteerRequirementPeriod: { findFirst: (...a: unknown[]) => findFirstPeriod(...a) },
    ptaVolunteerAgreementVersion: { findFirst: (...a: unknown[]) => findFirstAgreementVersion(...a) },
    ptaVolunteerBuyoutElection: { findMany: (...a: unknown[]) => findManyElections(...a) },
    ptaVolunteerAgreementAcceptance: { findMany: (...a: unknown[]) => findManyAcceptances(...a) },
    ptaVolunteerHourDispute: { findMany: (...a: unknown[]) => findManyDisputes(...a) },
  },
}));

const HOUSEHOLDS = [
  { id: "hh-1", displayName: "The Alpha Family", status: "ACTIVE", primaryContactAdultId: "adult-1" },
  { id: "hh-2", displayName: "The Beta Family", status: "ACTIVE", primaryContactAdultId: "adult-2" },
];

const BASE_PERIOD = {
  id: "period-1",
  name: "2026-2027 School Year",
  startsOn: new Date("2026-08-01"),
  endsOn: new Date("2027-06-01"),
  timezone: "America/Chicago",
  agreementRequired: true,
  agreementVersionId: "v2",
  contractLinkedBuyoutEnabled: false,
  contractLinkedEligibilityDays: null as number | null,
};

const ASSIGNED_VERSION = { id: "v2", title: "Volunteer Commitment Agreement", versionNumber: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  findManyHouseholds.mockResolvedValue(HOUSEHOLDS);
  findUniqueOrganization.mockResolvedValue({ name: "Lincoln Elementary PTA" });
  findUniqueOrgSettings.mockResolvedValue({ timezone: "America/Chicago" });
  findFirstPeriod.mockResolvedValue(BASE_PERIOD);
  findFirstAgreementVersion.mockResolvedValue(ASSIGNED_VERSION);
  findManyElections.mockResolvedValue([]);
  findManyAcceptances.mockResolvedValue([]);
  findManyDisputes.mockResolvedValue([]);
});

const filters = { requirementPeriodId: "period-1" };

describe("buildFamilyAgreementStatusReportData — Report H", () => {
  it("marks a household ACCEPTED with the accepting adult's name and an org-timezone-formatted acceptance time", async () => {
    findManyAcceptances.mockResolvedValue([
      {
        householdId: "hh-1",
        agreementVersionId: "v2",
        acceptedAt: new Date("2027-01-15T18:30:00Z"), // 12:30 PM America/Chicago (CST, UTC-6)
        acceptedByAdult: { name: "Jane Alpha" },
        typedName: null,
      },
    ]);

    const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
    const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");

    const row = data.rows.find((r) => r.householdId === "hh-1")!;
    expect(row.acceptanceStatus).toBe("ACCEPTED");
    expect(row.acceptedByName).toBe("Jane Alpha");
    expect(row.acceptedAtOrgTime).toContain("2027-01-15");
    expect(row.assignedAgreementTitle).toBe("Volunteer Commitment Agreement");
    expect(row.assignedAgreementVersionNumber).toBe(2);
  });

  it("falls back to typedName when no linked household-adult record exists on the acceptance", async () => {
    findManyAcceptances.mockResolvedValue([
      { householdId: "hh-1", agreementVersionId: "v2", acceptedAt: new Date(), acceptedByAdult: null, typedName: "Jane A." },
    ]);
    const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
    const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
    expect(data.rows.find((r) => r.householdId === "hh-1")!.acceptedByName).toBe("Jane A.");
  });

  it("marks a household with no acceptance at all NOT_YET_ACCEPTED, with a null acceptedByName/acceptedAtOrgTime", async () => {
    const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
    const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
    for (const row of data.rows) {
      expect(row.acceptanceStatus).toBe("NOT_YET_ACCEPTED");
      expect(row.acceptedByName).toBeNull();
      expect(row.acceptedAtOrgTime).toBeNull();
    }
  });

  it("marks every household NOT_REQUIRED when the period has no assigned agreement at all", async () => {
    findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementRequired: false, agreementVersionId: null });
    findFirstAgreementVersion.mockResolvedValue(null);
    const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
    const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
    for (const row of data.rows) {
      expect(row.acceptanceStatus).toBe("NOT_REQUIRED");
      expect(row.assignedAgreementTitle).toBeNull();
    }
  });

  it("flags a version mismatch when the household accepted a prior, now-superseded version, without marking them ACCEPTED", async () => {
    findManyAcceptances.mockResolvedValue([
      { householdId: "hh-1", agreementVersionId: "v1-OLD", acceptedAt: new Date("2026-09-01T00:00:00Z"), acceptedByAdult: { name: "Jane Alpha" }, typedName: null },
    ]);
    const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
    const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
    const row = data.rows.find((r) => r.householdId === "hh-1")!;
    expect(row.acceptanceStatus).toBe("NOT_YET_ACCEPTED"); // not accepted for the CURRENT version
    expect(row.versionMismatchNote).toMatch(/prior version/i);
    expect(row.versionMismatchNote).toMatch(/v2/);
  });

  it("never flags a mismatch for a household with no historical acceptance at all", async () => {
    const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
    const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
    for (const row of data.rows) expect(row.versionMismatchNote).toBeNull();
  });

  describe("contract-linked offer status", () => {
    it("is NOT_APPLICABLE when the period doesn't have contract-linked buyout enabled", async () => {
      const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
      const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
      for (const row of data.rows) {
        expect(row.contractLinkedOfferStatus).toBe("NOT_APPLICABLE");
        expect(row.offerExpirationOrgTime).toBeNull();
      }
    });

    it("is AWAITING_ACCEPTANCE when enabled but the household hasn't accepted yet", async () => {
      findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, contractLinkedBuyoutEnabled: true, contractLinkedEligibilityDays: 14 });
      const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
      const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
      for (const row of data.rows) expect(row.contractLinkedOfferStatus).toBe("AWAITING_ACCEPTANCE");
    });

    it("is OPEN within the eligibility window after acceptance, with a formatted expiration", async () => {
      findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, contractLinkedBuyoutEnabled: true, contractLinkedEligibilityDays: 14 });
      const acceptedAt = new Date(); // now -> definitely still open
      findManyAcceptances.mockResolvedValue([{ householdId: "hh-1", agreementVersionId: "v2", acceptedAt, acceptedByAdult: { name: "Jane" }, typedName: null }]);
      const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
      const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
      const row = data.rows.find((r) => r.householdId === "hh-1")!;
      expect(row.contractLinkedOfferStatus).toBe("OPEN");
      expect(row.offerExpirationOrgTime).not.toBeNull();
    });

    it("is EXPIRED once the eligibility window has passed", async () => {
      findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, contractLinkedBuyoutEnabled: true, contractLinkedEligibilityDays: 14 });
      const acceptedAt = new Date("2020-01-01T00:00:00Z"); // long past
      findManyAcceptances.mockResolvedValue([{ householdId: "hh-1", agreementVersionId: "v2", acceptedAt, acceptedByAdult: { name: "Jane" }, typedName: null }]);
      const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
      const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
      const row = data.rows.find((r) => r.householdId === "hh-1")!;
      expect(row.contractLinkedOfferStatus).toBe("EXPIRED");
    });
  });

  describe("election status", () => {
    it("maps VOLUNTEER/PARTIAL_BUYOUT/FULL_BUYOUT elections and defaults to NONE", async () => {
      findManyElections.mockResolvedValue([
        { householdId: "hh-1", electionType: "FULL_BUYOUT" },
        { householdId: "hh-2", electionType: "VOLUNTEER" },
      ]);
      const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
      const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
      expect(data.rows.find((r) => r.householdId === "hh-1")!.electionStatus).toBe("FULL_BUYOUT");
      expect(data.rows.find((r) => r.householdId === "hh-2")!.electionStatus).toBe("VOLUNTEER");
    });

    it("defaults to NONE when the household has no election at all", async () => {
      const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
      const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
      for (const row of data.rows) expect(row.electionStatus).toBe("NONE");
    });
  });

  describe("operational exception/review status", () => {
    it("surfaces the most recent dispute's status for a household, and null for a household with none", async () => {
      findManyDisputes.mockResolvedValue([{ householdId: "hh-1", status: "OPEN" }]);
      const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
      const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
      expect(data.rows.find((r) => r.householdId === "hh-1")!.operationalExceptionStatus).toBe("OPEN");
      expect(data.rows.find((r) => r.householdId === "hh-2")!.operationalExceptionStatus).toBeNull();
    });
  });

  it("carries zero dollar/payment fields anywhere on the row, and the summary's financial totals are explicitly undefined (never a redacted 0)", async () => {
    const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
    const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
    for (const row of data.rows) {
      const keys = Object.keys(row).join(" ").toLowerCase();
      expect(keys).not.toMatch(/cents|amount|balance|payment|provider/);
    }
    expect(data.summary.totalBuyoutRevenueCents).toBeUndefined();
    expect(data.summary.totalAssessmentsCents).toBeUndefined();
    expect(data.summary.outstandingBalanceCents).toBeUndefined();
  });

  it("short-circuits every household-scoped query when there are no households in scope, rather than issuing an unfiltered org-wide fetch", async () => {
    findManyHouseholds.mockResolvedValue([]);
    const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
    const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
    expect(data.rows).toHaveLength(0);
    expect(findManyElections).not.toHaveBeenCalled();
    expect(findManyAcceptances).not.toHaveBeenCalled();
    expect(findManyDisputes).not.toHaveBeenCalled();
  });

  it("scopes every household-scoped query to the exact requested organizationId and period", async () => {
    findManyAcceptances.mockResolvedValue([{ householdId: "hh-1", agreementVersionId: "v2", acceptedAt: new Date(), acceptedByAdult: { name: "Jane" }, typedName: null }]);
    const { buildFamilyAgreementStatusReportData } = await import("../family-agreement-status");
    await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
    expect(findManyElections).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1", requirementPeriodId: "period-1" }) }));
    expect(findManyAcceptances).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1", requirementPeriodId: "period-1" }) }));
    expect(findManyDisputes).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1", requirementPeriodId: "period-1" }) }));
  });

  it("FAMILY_AGREEMENT_STATUS_COLUMNS.getValue reads every field without throwing, for every acceptance/offer/election/mismatch/dispute combination above", async () => {
    findManyAcceptances.mockResolvedValue([
      { householdId: "hh-1", agreementVersionId: "v2", acceptedAt: new Date(), acceptedByAdult: { name: "Jane" }, typedName: null },
    ]);
    findManyElections.mockResolvedValue([{ householdId: "hh-2", electionType: "PARTIAL_BUYOUT" }]);
    findManyDisputes.mockResolvedValue([{ householdId: "hh-2", status: "RESOLVED" }]);
    const { buildFamilyAgreementStatusReportData, FAMILY_AGREEMENT_STATUS_COLUMNS } = await import("../family-agreement-status");
    const data = await buildFamilyAgreementStatusReportData("org-1", filters, "Officer Jones");
    for (const row of data.rows) {
      for (const col of FAMILY_AGREEMENT_STATUS_COLUMNS) {
        expect(() => col.getValue(row)).not.toThrow();
      }
    }
  });
});
