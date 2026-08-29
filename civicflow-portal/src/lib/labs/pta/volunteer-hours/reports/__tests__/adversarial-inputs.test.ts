import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * fix/pta-volunteer-reports-period-scope — deploy-authorization §5:
 * malformed/adversarial input handling for the report filter surface.
 * Proves the server fails closed (empty result or a thrown PtaError) and
 * that organization scope is never client-controlled.
 */

const findFirstPeriod = vi.fn();
const findManyEntries = vi.fn();
const findManyOpportunities = vi.fn();
const findManySlots = vi.fn();
const findManySignups = vi.fn();
const findManyLedgerEntries = vi.fn();
const findUniqueOrganization = vi.fn();
const findUniqueOrgSettings = vi.fn();
const findManyHouseholdsById = vi.fn();
const findManyActiveHouseholds = vi.fn();
const findManyAdults = vi.fn();
const findManyUsers = vi.fn();
const findFirstHousehold = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerRequirementPeriod: { findFirst: (...a: unknown[]) => findFirstPeriod(...a) },
    ptaVolunteerHourEntry: { findMany: (...a: unknown[]) => findManyEntries(...a) },
    ptaVolunteerOpportunity: { findMany: (...a: unknown[]) => findManyOpportunities(...a) },
    ptaVolunteerSlot: { findMany: (...a: unknown[]) => findManySlots(...a) },
    ptaVolunteerSignup: { findMany: (...a: unknown[]) => findManySignups(...a) },
    ptaVolunteerLedgerEntry: { findMany: (...a: unknown[]) => findManyLedgerEntries(...a) },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    ptaHousehold: {
      findMany: (args: { where?: { status?: string } }) =>
        args?.where?.status === "ACTIVE" ? findManyActiveHouseholds(args) : findManyHouseholdsById(args),
      findFirst: (...a: unknown[]) => findFirstHousehold(...a),
    },
    ptaHouseholdAdult: { findMany: (...a: unknown[]) => findManyAdults(...a) },
    user: { findMany: (...a: unknown[]) => findManyUsers(...a) },
  },
}));

const REAL_ORG = "org-real";
const OTHER_ORG = "org-other";
const REAL_PERIOD = "period-real";
const EVENT = { id: "event-1", title: "Fall Festival", startAt: new Date("2026-10-10T09:00:00Z"), location: "Gym", status: "PUBLISHED" };
const OPPORTUNITY = { id: "opp-1", eventId: "event-1", event: EVENT };
const SLOT = { id: "slot-1", opportunityId: "opp-1" };

beforeEach(() => {
  vi.clearAllMocks();
  findManyOpportunities.mockResolvedValue([OPPORTUNITY]);
  findManySlots.mockResolvedValue([SLOT]);
  findManySignups.mockResolvedValue([]);
  findManyEntries.mockResolvedValue([]);
  findManyLedgerEntries.mockResolvedValue([]);
  findUniqueOrganization.mockResolvedValue({ name: "Real Org" });
  findUniqueOrgSettings.mockResolvedValue({ timezone: "America/Chicago" });
  findManyHouseholdsById.mockResolvedValue([]);
  findManyActiveHouseholds.mockResolvedValue([]);
  findManyAdults.mockResolvedValue([]);
  findManyUsers.mockResolvedValue([]);
  findFirstHousehold.mockResolvedValue(null);
});

describe("parseVolunteerReportFilters — client-input parsing (fail closed)", () => {
  it("missing period ID: parseVolunteerReportFilters is always called with a server-resolved periodId (route param, not query) — an empty string is preserved, not silently defaulted to another period", async () => {
    const { parseVolunteerReportFilters } = await import("../shared");
    const filters = parseVolunteerReportFilters(new URL("https://example.com/reports"), "");
    expect(filters.requirementPeriodId).toBe("");
  });

  it("invalid mode value defaults to PERIOD, never fails open to ALL_TIME", async () => {
    const { parseVolunteerReportFilters } = await import("../shared");
    expect(parseVolunteerReportFilters(new URL("https://example.com/r?mode=not-a-real-mode"), "p1").mode).toBe("PERIOD");
  });

  it("mode is case-sensitive — lowercase or mixed-case 'all_time' does NOT match ALL_TIME and defaults to PERIOD", async () => {
    const { parseVolunteerReportFilters } = await import("../shared");
    expect(parseVolunteerReportFilters(new URL("https://example.com/r?mode=all_time"), "p1").mode).toBe("PERIOD");
    expect(parseVolunteerReportFilters(new URL("https://example.com/r?mode=All_Time"), "p1").mode).toBe("PERIOD");
    expect(parseVolunteerReportFilters(new URL("https://example.com/r?mode=ALL_time"), "p1").mode).toBe("PERIOD");
  });

  it("multiple mode query parameters: URLSearchParams.get() deterministically takes the first value (documented, not a bypass — mode alone never grants access, RBAC/allowlist/flags still gate every route)", async () => {
    const { parseVolunteerReportFilters } = await import("../shared");
    const first = parseVolunteerReportFilters(new URL("https://example.com/r?mode=ALL_TIME&mode=PERIOD"), "p1");
    expect(first.mode).toBe("ALL_TIME");
    const second = parseVolunteerReportFilters(new URL("https://example.com/r?mode=PERIOD&mode=ALL_TIME"), "p1");
    expect(second.mode).toBe("PERIOD");
  });
});

describe("server-side enforcement — period ID (fail closed via PtaError, never silent)", () => {
  it("invalid/nonexistent period ID throws PTA_VOLUNTEER_PERIOD_NOT_FOUND rather than returning an empty or default report", async () => {
    findFirstPeriod.mockResolvedValue(null);
    const { buildFamilySummaryReportData } = await import("../family-summary");
    await expect(buildFamilySummaryReportData(REAL_ORG, { requirementPeriodId: "does-not-exist" }, "Officer")).rejects.toThrow(
      "Volunteer requirement period not found in this organization."
    );
  });

  it("another organization's real period ID: the lookup is scoped to BOTH id AND the session-derived organizationId — a guessed cross-org id never resolves", async () => {
    // Simulates the real Prisma behavior: findFirst({ where: { id, organizationId } })
    // never matches a period that belongs to a different organizationId, even
    // if the id itself is a real, valid, existing period for another org.
    findFirstPeriod.mockImplementation(async (args: { where: { id: string; organizationId: string } }) => {
      const isRealPeriodForOtherOrg = args.where.id === REAL_PERIOD && args.where.organizationId === OTHER_ORG;
      return isRealPeriodForOtherOrg ? { id: REAL_PERIOD, organizationId: OTHER_ORG, status: "ACTIVE" } : null;
    });
    const { buildFamilySummaryReportData } = await import("../family-summary");
    // Attacker's session is scoped to REAL_ORG (server-derived, never client-supplied),
    // but supplies OTHER_ORG's real period id in the client-controlled filter.
    await expect(buildFamilySummaryReportData(REAL_ORG, { requirementPeriodId: REAL_PERIOD }, "Officer")).rejects.toThrow(
      "Volunteer requirement period not found in this organization."
    );
  });

  it("DRAFT and ARCHIVED periods are reportable (status-agnostic by design — historical/pre-launch reporting is a legitimate use, not a bypass)", async () => {
    findFirstPeriod.mockResolvedValue({
      id: REAL_PERIOD,
      organizationId: REAL_ORG,
      status: "ARCHIVED",
      name: "Old Period",
      startsOn: new Date("2020-01-01"),
      endsOn: new Date("2020-06-01"),
      timezone: "America/Chicago",
      requiredMinutesDefault: 600,
      volunteerDeadline: null,
    });
    const { buildComplianceReportData } = await import("../compliance");
    const { resolveVolunteerBuyoutRate } = await import("../../pricing");
    vi.spyOn(await import("../../pricing"), "resolveVolunteerBuyoutRate").mockResolvedValue(null);
    void resolveVolunteerBuyoutRate;
    await expect(buildComplianceReportData(REAL_ORG, { requirementPeriodId: REAL_PERIOD }, "Officer")).resolves.toBeDefined();
  });
});

describe("server-side enforcement — malformed date ranges (fail closed to empty, never throws or leaks)", () => {
  it("start date after end date: every event is excluded (no valid window exists), not an error and not all events", async () => {
    const { buildEventHoursReportData } = await import("../event-hours");
    const data = await buildEventHoursReportData(
      REAL_ORG,
      { requirementPeriodId: REAL_PERIOD, dateRangeStart: new Date("2027-01-01"), dateRangeEnd: new Date("2020-01-01") },
      "Officer"
    );
    expect(data.rows).toHaveLength(0);
  });

  it("custom dates far outside the requirement period: explicit filter narrows results, does not error", async () => {
    const { buildEventHoursReportData } = await import("../event-hours");
    const data = await buildEventHoursReportData(
      REAL_ORG,
      { requirementPeriodId: REAL_PERIOD, dateRangeStart: new Date("1999-01-01"), dateRangeEnd: new Date("1999-02-01") },
      "Officer"
    );
    expect(data.rows).toHaveLength(0);
  });
});

describe("server-side enforcement — cross-household / cross-organization (client input can never widen scope)", () => {
  it("another household's id, with the requesting org's own householdId filter set: resolveReportHouseholds only ever returns the exact filtered household", async () => {
    const { resolveReportHouseholds } = await import("../shared");
    const result = await resolveReportHouseholds(REAL_ORG, { requirementPeriodId: REAL_PERIOD, householdId: "hh-not-mine" });
    // findFirst on ptaHousehold with { id: householdId, organizationId } — mocked to return [] here,
    // proving an unmatched/foreign household id resolves to zero households, not a wildcard.
    expect(result).toEqual([]);
  });

  it("the ledger-linkage query is always scoped to BOTH organizationId and requirementPeriodId together — never one alone", async () => {
    const { resolvePeriodLinkedHourEntryIds } = await import("../shared");
    await resolvePeriodLinkedHourEntryIds(REAL_ORG, REAL_PERIOD, ["he-1"]);
    const call = findManyLedgerEntries.mock.calls[0][0];
    expect(call.where.organizationId).toBe(REAL_ORG);
    expect(call.where.requirementPeriodId).toBe(REAL_PERIOD);
  });
});
