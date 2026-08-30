import { beforeEach, describe, expect, it, vi } from "vitest";

const getVolunteerRequirementPeriod = vi.fn();
vi.mock("../periods", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../periods")>();
  return { ...actual, getVolunteerRequirementPeriod: (...a: unknown[]) => getVolunteerRequirementPeriod(...a) };
});

const resolveHouseholdRequirement = vi.fn();
vi.mock("../assignments", () => ({ resolveHouseholdRequirement: (...a: unknown[]) => resolveHouseholdRequirement(...a) }));

const getHouseholdLedgerTotals = vi.fn();
vi.mock("../ledger", () => ({ getHouseholdLedgerTotals: (...a: unknown[]) => getHouseholdLedgerTotals(...a) }));

const resolveVolunteerBuyoutRate = vi.fn();
vi.mock("../pricing", () => ({ resolveVolunteerBuyoutRate: (...a: unknown[]) => resolveVolunteerBuyoutRate(...a) }));

const createElection = vi.fn();
const findFirstElection = vi.fn();
const findUniquePricingWindow = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerBuyoutElection: {
      create: (...a: unknown[]) => createElection(...a),
      findFirst: (...a: unknown[]) => findFirstElection(...a),
    },
    ptaVolunteerPricingWindow: {
      findUnique: (...a: unknown[]) => findUniquePricingWindow(...a),
    },
  },
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
  status: "ACTIVE" as const,
  buyoutWindowStart: null as Date | null,
  buyoutWindowEnd: null as Date | null,
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
      code: "PTA_VOLUNTEER_NO_APPLICABLE_RATE",
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

describe("buildBuyoutQuote — FC-5 server-side eligibility (period/window/exempt/already-satisfied)", () => {
  it("rejects a FULL_BUYOUT when the period isn't ACTIVE", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue({ ...basePeriod, status: "DRAFT" });
    const { buildBuyoutQuote } = await import("../elections");
    await expect(buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT" })).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_PERIOD_NOT_ACTIVE",
    });
    expect(resolveVolunteerBuyoutRate).not.toHaveBeenCalled();
  });

  it("rejects a PARTIAL_BUYOUT before the period's buyoutWindowStart", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue({ ...basePeriod, buyoutWindowStart: new Date(Date.now() + 60_000) });
    const { buildBuyoutQuote } = await import("../elections");
    await expect(
      buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 60 })
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_BUYOUT_NOT_YET_OPEN" });
  });

  it("rejects a PARTIAL_BUYOUT at/after the period's buyoutWindowEnd (close is exclusive)", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue({ ...basePeriod, buyoutWindowEnd: new Date(Date.now() - 1) });
    const { buildBuyoutQuote } = await import("../elections");
    await expect(
      buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 60 })
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_BUYOUT_CLOSED" });
  });

  it("allows a PARTIAL_BUYOUT at the exact buyoutWindowStart instant (open boundary is inclusive)", async () => {
    const now = new Date();
    getVolunteerRequirementPeriod.mockResolvedValue({ ...basePeriod, buyoutWindowStart: now });
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-2", amountCents: 1_500 });
    const { buildBuyoutQuote } = await import("../elections");
    // A window that starts "right now" per the mocked clock will, in practice, always be <= Date.now()
    // by the time the function runs — this asserts inclusivity isn't accidentally implemented as `<`.
    await expect(
      buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 60 })
    ).resolves.toBeTruthy();
  });

  it("rejects a buyout election for an EXEMPT_FULL household — nothing to buy out", async () => {
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 0, assignmentType: "EXEMPT_FULL", matchedScopeType: "HOUSEHOLD", assignmentId: "a1", reason: "hardship", exempt: true });
    const { buildBuyoutQuote } = await import("../elections");
    await expect(buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT" })).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_HOUSEHOLD_EXEMPT",
    });
    expect(resolveVolunteerBuyoutRate).not.toHaveBeenCalled();
  });

  it("still allows an EXEMPT household to record a VOLUNTEER election (free, harmless)", async () => {
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 0, assignmentType: "EXEMPT_FULL", matchedScopeType: "HOUSEHOLD", assignmentId: "a1", reason: "hardship", exempt: true });
    const { buildBuyoutQuote } = await import("../elections");
    const quote = await buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "VOLUNTEER" });
    expect(quote.totalCents).toBe(0);
  });

  it("rejects FULL_BUYOUT when the household has already fully met its requirement", async () => {
    getHouseholdLedgerTotals.mockResolvedValue({ ...emptyTotals, verifiedMinutes: 1200 }); // required 1200, all done
    const { buildBuyoutQuote } = await import("../elections");
    await expect(buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "FULL_BUYOUT" })).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_ALREADY_SATISFIED",
    });
  });

  it("caps a PARTIAL_BUYOUT request at what's actually still owed, not the static requirement ceiling", async () => {
    // required 1200, already purchased 1140 (completed) -> only 60 min left, even though the period's
    // own max-purchase config would otherwise allow up to 1200.
    getHouseholdLedgerTotals.mockResolvedValue({ ...emptyTotals, purchasedMinutes: 1140 });
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-2", amountCents: 1_500 });
    const { buildBuyoutQuote } = await import("../elections");
    await expect(
      buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 120 })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    await expect(
      buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 60 })
    ).resolves.toBeTruthy();
  });

  it("rejects a PARTIAL_BUYOUT with PTA_VOLUNTEER_NO_APPLICABLE_RATE when no PER_HOUR window is active", async () => {
    resolveVolunteerBuyoutRate.mockResolvedValue(null);
    const { buildBuyoutQuote } = await import("../elections");
    await expect(
      buildBuyoutQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 60 })
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_NO_APPLICABLE_RATE" });
  });
});

describe("resolveLockedOrFreshQuote — FC-4 lock-timing dispatch (docs/pta-volunteer-hours-pricing-lock-design.md)", () => {
  const election = {
    id: "election-1",
    electionType: "PARTIAL_BUYOUT" as const,
    hoursElectedMinutes: 480,
    quotedRateCents: 1_500,
    quotedTotalCents: 12_000,
    pricingWindowId: "window-1",
  };

  function mockFindFirstElection(byIdResult: typeof election | null, latestResult: typeof election | null) {
    findFirstElection.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      return "id" in where ? byIdResult : latestResult;
    });
  }

  it("honors the election's frozen price when the window is ELECTION-locked, still active, and not yet closed", async () => {
    mockFindFirstElection(election, election);
    findUniquePricingWindow.mockResolvedValue({ id: "window-1", lockTiming: "ELECTION", active: true, endAt: new Date(Date.now() + 60_000) });
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue(emptyTotals);

    const { resolveLockedOrFreshQuote } = await import("../elections");
    const quote = await resolveLockedOrFreshQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", electionId: "election-1" });

    expect(quote).toMatchObject({ rateCents: 1_500, totalCents: 12_000, hoursElectedMinutes: 480, pricingWindowId: "window-1" });
    expect(quote.remainingAfterMinutes).toBe(720); // 1200 required - 480 locked hours, live totals otherwise empty
    // The locked path must never call the fresh-quote engine — that's the whole point of the lock.
    expect(resolveVolunteerBuyoutRate).not.toHaveBeenCalled();
  });

  it("FC-5: rejects an ELECTION-locked redemption if the household became exempt since electing — price is frozen, eligibility is not", async () => {
    mockFindFirstElection(election, election);
    findUniquePricingWindow.mockResolvedValue({ id: "window-1", lockTiming: "ELECTION", active: true, endAt: new Date(Date.now() + 60_000) });
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 0, assignmentType: "EXEMPT_FULL", matchedScopeType: "HOUSEHOLD", assignmentId: "a1", reason: "hardship", exempt: true });
    getHouseholdLedgerTotals.mockResolvedValue(emptyTotals);

    const { resolveLockedOrFreshQuote } = await import("../elections");
    await expect(
      resolveLockedOrFreshQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", electionId: "election-1" })
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_HOUSEHOLD_EXEMPT" });
  });

  it("FC-5: rejects an ELECTION-locked redemption if the household's requirement is already fully satisfied", async () => {
    mockFindFirstElection(election, election);
    findUniquePricingWindow.mockResolvedValue({ id: "window-1", lockTiming: "ELECTION", active: true, endAt: new Date(Date.now() + 60_000) });
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, assignmentType: "STANDARD", matchedScopeType: null, assignmentId: null, reason: null, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({ ...emptyTotals, verifiedMinutes: 1200 });

    const { resolveLockedOrFreshQuote } = await import("../elections");
    await expect(
      resolveLockedOrFreshQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", electionId: "election-1" })
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_ALREADY_SATISFIED" });
  });

  it("RV-7: rejects an ELECTION-locked redemption once the period's OVERALL buyout window has closed, even though the PRICING window it was quoted against is still open -- the outer window always governs too, not just the window's own endAt", async () => {
    mockFindFirstElection(election, election);
    findUniquePricingWindow.mockResolvedValue({ id: "window-1", lockTiming: "ELECTION", active: true, endAt: new Date(Date.now() + 60_000) });
    getVolunteerRequirementPeriod.mockResolvedValue({ ...basePeriod, buyoutWindowStart: new Date(Date.now() - 120_000), buyoutWindowEnd: new Date(Date.now() - 60_000) });

    const { resolveLockedOrFreshQuote } = await import("../elections");
    await expect(
      resolveLockedOrFreshQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", electionId: "election-1" })
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_BUYOUT_CLOSED" });
  });

  it("RV-7: an ELECTION-locked redemption survives a LATER, unrelated pricing window opening -- only the window it was quoted against, and the period's own overall window, matter", async () => {
    mockFindFirstElection(election, election);
    // The election's own window (window-1) is still open; a completely
    // separate later window (window-2, not referenced by this election)
    // existing has zero bearing on this lookup -- resolveLockedOrFreshQuote
    // never queries "is there a newer window," only window-1's own state.
    findUniquePricingWindow.mockResolvedValue({ id: "window-1", lockTiming: "ELECTION", active: true, endAt: new Date(Date.now() + 60_000) });

    const { resolveLockedOrFreshQuote } = await import("../elections");
    const quote = await resolveLockedOrFreshQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", electionId: "election-1" });

    expect(quote).toMatchObject({ rateCents: 1_500, totalCents: 12_000, pricingWindowId: "window-1" });
    expect(findUniquePricingWindow).toHaveBeenCalledWith({ where: { id: "window-1" } });
  });

  it("falls back to a fresh quote when the window is CHECKOUT-locked, even with a valid election", async () => {
    mockFindFirstElection(election, election);
    findUniquePricingWindow.mockResolvedValue({ id: "window-1", lockTiming: "CHECKOUT", active: true, endAt: new Date(Date.now() + 60_000) });
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-2", amountCents: 2_000 }); // rate changed since election

    const { resolveLockedOrFreshQuote } = await import("../elections");
    const quote = await resolveLockedOrFreshQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", electionId: "election-1", hoursElectedMinutes: 480 });

    expect(quote.rateCents).toBe(2_000); // the NEW rate, not the election's 1,500 snapshot
    expect(quote.totalCents).toBe(16_000);
  });

  it("falls back to a fresh quote when a later election has superseded the one referenced", async () => {
    const laterElection = { ...election, id: "election-2" };
    mockFindFirstElection(election, laterElection); // by-id finds election-1, but latest is election-2
    findUniquePricingWindow.mockResolvedValue({ id: "window-1", lockTiming: "ELECTION", active: true, endAt: new Date(Date.now() + 60_000) });
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-2", amountCents: 2_000 });

    const { resolveLockedOrFreshQuote } = await import("../elections");
    const quote = await resolveLockedOrFreshQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", electionId: "election-1", hoursElectedMinutes: 480 });

    expect(quote.rateCents).toBe(2_000);
  });

  it("falls back to a fresh quote when the ELECTION-locked window has already closed", async () => {
    mockFindFirstElection(election, election);
    findUniquePricingWindow.mockResolvedValue({ id: "window-1", lockTiming: "ELECTION", active: true, endAt: new Date(Date.now() - 60_000) });
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-2", amountCents: 2_000 });

    const { resolveLockedOrFreshQuote } = await import("../elections");
    const quote = await resolveLockedOrFreshQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", electionId: "election-1", hoursElectedMinutes: 480 });

    expect(quote.rateCents).toBe(2_000);
  });

  it("falls back to a fresh quote when the ELECTION-locked window has been deactivated", async () => {
    mockFindFirstElection(election, election);
    findUniquePricingWindow.mockResolvedValue({ id: "window-1", lockTiming: "ELECTION", active: false, endAt: new Date(Date.now() + 60_000) });
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-2", amountCents: 2_000 });

    const { resolveLockedOrFreshQuote } = await import("../elections");
    const quote = await resolveLockedOrFreshQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", electionId: "election-1", hoursElectedMinutes: 480 });

    expect(quote.rateCents).toBe(2_000);
  });

  it("falls back to a fresh quote when no electionId is provided at all", async () => {
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-2", amountCents: 2_000 });
    const { resolveLockedOrFreshQuote } = await import("../elections");
    const quote = await resolveLockedOrFreshQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 480 });
    expect(quote.rateCents).toBe(2_000);
    expect(findFirstElection).not.toHaveBeenCalled();
  });

  it("falls back to a fresh quote when the referenced election id doesn't exist in this org/period/household", async () => {
    findFirstElection.mockResolvedValue(null);
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-2", amountCents: 2_000 });
    const { resolveLockedOrFreshQuote } = await import("../elections");
    const quote = await resolveLockedOrFreshQuote("org-1", "period-1", "hh-1", { electionType: "PARTIAL_BUYOUT", electionId: "not-mine", hoursElectedMinutes: 480 });
    expect(quote.rateCents).toBe(2_000);
  });
});
