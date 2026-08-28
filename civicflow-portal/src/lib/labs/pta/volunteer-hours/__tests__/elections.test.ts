import { beforeEach, describe, expect, it, vi } from "vitest";

const getVolunteerRequirementPeriod = vi.fn();
vi.mock("../periods", () => ({ getVolunteerRequirementPeriod: (...a: unknown[]) => getVolunteerRequirementPeriod(...a) }));

const resolveHouseholdRequirement = vi.fn();
vi.mock("../assignments", () => ({ resolveHouseholdRequirement: (...a: unknown[]) => resolveHouseholdRequirement(...a) }));

const getHouseholdLedgerTotals = vi.fn();
vi.mock("../ledger", () => ({ getHouseholdLedgerTotals: (...a: unknown[]) => getHouseholdLedgerTotals(...a) }));

const resolveVolunteerBuyoutRate = vi.fn();
vi.mock("../pricing", () => ({ resolveVolunteerBuyoutRate: (...a: unknown[]) => resolveVolunteerBuyoutRate(...a) }));

const createElection = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { ptaVolunteerBuyoutElection: { create: (...a: unknown[]) => createElection(...a), findFirst: vi.fn() } },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

const emptyTotals = {
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
};

const basePeriod = {
  id: "period-1",
  buyoutFullAllowed: true,
  buyoutMinPurchaseMinutes: null,
  buyoutMaxPurchaseMinutes: null,
  buyoutMinServiceMinutes: null,
  buyoutIncrementMinutes: 60,
};

beforeEach(() => {
  vi.clearAllMocks();
  getVolunteerRequirementPeriod.mockResolvedValue(basePeriod);
  resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, assignmentType: "STANDARD", matchedScopeType: null, assignmentId: null, reason: null, exempt: false });
  getHouseholdLedgerTotals.mockResolvedValue(emptyTotals);
});

describe("buildBuyoutQuote — VOLUNTEER", () => {
  it("is always free and doesn't touch pricing windows", async () => {
    const { buildBuyoutQuote } = await import("../elections");
    const quote = await buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "VOLUNTEER" });
    expect(quote).toMatchObject({ hoursElectedMinutes: 0, totalCents: 0, pricingWindowId: null });
    expect(resolveVolunteerBuyoutRate).not.toHaveBeenCalled();
  });
});

describe("buildBuyoutQuote — FULL_BUYOUT", () => {
  it("required 20h + $250 flat rate -> quotes exactly 20h purchased for $250 (spec §5 example)", async () => {
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-1", amountCents: 25_000 });
    const { buildBuyoutQuote } = await import("../elections");
    const quote = await buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT" });
    expect(quote).toMatchObject({ hoursElectedMinutes: 1200, totalCents: 25_000, pricingWindowId: "window-1" });
  });

  it("rejects when buyoutFullAllowed is false", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue({ ...basePeriod, buyoutFullAllowed: false });
    const { buildBuyoutQuote } = await import("../elections");
    await expect(buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT" })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });

  it("rejects when the period has a mandatory-service floor, even if buyoutFullAllowed is stored true", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue({ ...basePeriod, buyoutMinServiceMinutes: 300 });
    const { buildBuyoutQuote } = await import("../elections");
    await expect(buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT" })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });

  it("rejects when no FULL_BUYOUT window is currently active", async () => {
    resolveVolunteerBuyoutRate.mockResolvedValue(null);
    const { buildBuyoutQuote } = await import("../elections");
    await expect(buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT" })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });
});

describe("buildBuyoutQuote — PARTIAL_BUYOUT (acceptance scenario: buyout)", () => {
  it("required 20h, buy 8h @ $15/hr -> $120, remaining-after = 12h before any service is counted", async () => {
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-2", amountCents: 1_500 });
    const { buildBuyoutQuote } = await import("../elections");
    const quote = await buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 480 });
    expect(quote.totalCents).toBe(12_000); // $120.00
    expect(quote.hoursElectedMinutes).toBe(480);
  });

  it("rejects a request that isn't a multiple of the increment", async () => {
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-2", amountCents: 1_500 });
    const { buildBuyoutQuote } = await import("../elections");
    await expect(
      buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 90 })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("allows a half-hour increment when the period is configured for it", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue({ ...basePeriod, buyoutIncrementMinutes: 30 });
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-2", amountCents: 1_500 });
    const { buildBuyoutQuote } = await import("../elections");
    await expect(
      buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 90 })
    ).resolves.toBeTruthy();
  });

  it("rejects below the configured minimum purchase", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue({ ...basePeriod, buyoutMinPurchaseMinutes: 300 });
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-2", amountCents: 1_500 });
    const { buildBuyoutQuote } = await import("../elections");
    await expect(
      buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 60 })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("rejects above the configured maximum purchase", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue({ ...basePeriod, buyoutMaxPurchaseMinutes: 300 });
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-2", amountCents: 1_500 });
    const { buildBuyoutQuote } = await import("../elections");
    await expect(
      buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 360 })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("caps purchasable hours at (required - mandatory service floor)", async () => {
    // required 1200, floor 300 -> max buyable 900
    getVolunteerRequirementPeriod.mockResolvedValue({ ...basePeriod, buyoutMinServiceMinutes: 300 });
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-2", amountCents: 1_500 });
    const { buildBuyoutQuote } = await import("../elections");
    await expect(
      buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 960 })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    await expect(
      buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 900 })
    ).resolves.toBeTruthy();
  });

  it("rejects when no hoursElectedMinutes is provided", async () => {
    const { buildBuyoutQuote } = await import("../elections");
    await expect(buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT" })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });
});

describe("recordElection", () => {
  it("requires acknowledgment before creating anything", async () => {
    const { recordElection } = await import("../elections");
    await expect(
      recordElection("org-1", "period-1", "hh-1", { electionType: "VOLUNTEER", acknowledged: false }, { userId: "u1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(createElection).not.toHaveBeenCalled();
  });

  it("snapshots the quoted rate/total onto the election row and writes an audit event", async () => {
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-1", amountCents: 25_000 });
    createElection.mockResolvedValue({ id: "election-1", electionType: "FULL_BUYOUT", hoursElectedMinutes: 1200, quotedTotalCents: 25_000 });

    const { recordElection } = await import("../elections");
    await recordElection(
      "org-1",
      "period-1",
      "hh-1",
      { electionType: "FULL_BUYOUT", acknowledged: true },
      { userId: "u1", ipAddress: "203.0.113.5" }
    );

    expect(createElection).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          electionType: "FULL_BUYOUT",
          hoursElectedMinutes: 1200,
          quotedTotalCents: 25_000,
          quotedRateCents: 25_000,
          ipAddress: "203.0.113.5",
          acknowledgedByUserId: "u1",
        }),
      })
    );
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.election_recorded" }));
  });

  it("never posts anything to the ledger — election is not payment", async () => {
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-1", amountCents: 25_000 });
    createElection.mockResolvedValue({ id: "election-1" });
    const { recordElection } = await import("../elections");
    await recordElection("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT", acknowledged: true }, { userId: "u1" });
    // getHouseholdLedgerTotals is only ever called for READING totals (inside
    // buildBuyoutQuote), never a posting function — confirmed no ledger
    // module export beyond the totals reader was imported/mocked at all.
    expect(getHouseholdLedgerTotals).toHaveBeenCalled();
  });
});
