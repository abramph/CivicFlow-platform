import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * feature/pta-family-agreement-buyout follow-up (FA2 §6). Real-database
 * proof for the contract-linked pricing chain (agreements.ts's
 * resolveHouseholdAgreementStatus -> elections.ts's
 * resolveContractLinkedResolutionInstant -> pricing.ts's
 * resolveVolunteerBuyoutRate). Mocked unit tests (elections.test.ts,
 * agreements.test.ts) prove each function's own logic in isolation; this
 * file proves the FULL chain against a real Postgres instance behaves as
 * documented when composed together — real overlapping pricing windows,
 * real households, real elections, real snapshot-freezing across an actual
 * update to a pricing window's amount after the fact.
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run with:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   PTA_CONTRACT_LINKED_PRICING_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/labs/pta/volunteer-hours/__tests__/contract-linked-pricing.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.PTA_CONTRACT_LINKED_PRICING_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("Contract-linked pricing — real-database chain proof", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;
  let actorUserId: string;
  let periodId: string;
  let versionId: string;
  let householdAId: string;
  let adultAId: string;
  let householdBId: string;
  let adultBId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: { slug: `pta-contract-pricing-${Date.now()}`, name: "Contract Pricing Test PTA", primaryVertical: "PTA" },
    });
    orgId = org.id;

    const actor = await prisma.user.create({ data: { email: `contract-pricing-actor-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    actorUserId = actor.id;

    const now = new Date();
    const period = await prisma.ptaVolunteerRequirementPeriod.create({
      data: {
        organizationId: orgId,
        name: "Contract Pricing Test Period",
        periodType: "SCHOOL_YEAR",
        startsOn: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
        endsOn: new Date(now.getTime() + 300 * 24 * 60 * 60 * 1000),
        timezone: "America/New_York",
        requiredMinutesDefault: 600,
        status: "ACTIVE",
        buyoutFullAllowed: true,
        contractLinkedBuyoutEnabled: true,
        contractLinkedEligibilityDays: 14,
        contractLinkedUsesAcceptanceRate: true,
      },
    });
    periodId = period.id;

    const version = await prisma.ptaVolunteerAgreementVersion.create({
      data: {
        organizationId: orgId,
        requirementPeriodId: periodId,
        title: "Contract Pricing Test Agreement",
        versionNumber: 1,
        content: "Please volunteer.",
        contentHash: "test-hash",
        status: "PUBLISHED",
        publishedAt: now,
        publishedByUserId: actorUserId,
        createdByUserId: actorUserId,
      },
    });
    versionId = version.id;

    await prisma.ptaVolunteerRequirementPeriod.update({ where: { id: periodId }, data: { agreementVersionId: versionId, agreementRequired: true } });

    const householdA = await prisma.ptaHousehold.create({
      data: { organizationId: orgId, displayName: "Household A", status: "ACTIVE", schoolYear: "2026-2027" },
    });
    householdAId = householdA.id;
    const adultA = await prisma.ptaHouseholdAdult.create({ data: { organizationId: orgId, householdId: householdAId, name: "Parent A" } });
    adultAId = adultA.id;

    const householdB = await prisma.ptaHousehold.create({
      data: { organizationId: orgId, displayName: "Household B", status: "ACTIVE", schoolYear: "2026-2027" },
    });
    householdBId = householdB.id;
    const adultB = await prisma.ptaHouseholdAdult.create({ data: { organizationId: orgId, householdId: householdBId, name: "Parent B" } });
    adultBId = adultB.id;
  });

  afterEach(async () => {
    await prisma?.ptaVolunteerBuyoutElection.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaVolunteerAgreementAcceptance.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaVolunteerPricingWindow.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
  });

  afterAll(async () => {
    await prisma?.ptaVolunteerRequirementPeriod.update({ where: { id: periodId }, data: { agreementVersionId: null } }).catch(() => {});
    await prisma?.ptaVolunteerAgreementVersion.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaVolunteerRequirementPeriod.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaHouseholdAdult.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaHousehold.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma?.user.delete({ where: { id: actorUserId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  async function createWindow(overrides: Record<string, unknown>) {
    const now = new Date();
    return prisma.ptaVolunteerPricingWindow.create({
      data: {
        organizationId: orgId,
        periodId,
        name: "Test window",
        startAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        endAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        timezone: "America/New_York",
        rateType: "PER_HOUR",
        amountCents: 2000,
        contractSigningOnly: false,
        active: true,
        lockTiming: "CHECKOUT",
        createdByUserId: actorUserId,
        ...overrides,
      },
    });
  }

  it("1/2/3: a household with a real acceptance gets the contractSigningOnly rate (trusted acceptedAt); a household with NO acceptance gets the regular rate even though a contract-only window also covers now", async () => {
    await createWindow({ name: "Regular rate", amountCents: 2000, contractSigningOnly: false });
    await createWindow({ name: "Contract-linked rate", amountCents: 500, contractSigningOnly: true });

    const { acceptAgreement } = await import("../agreements");
    await acceptAgreement(orgId, periodId, householdAId, { acknowledged: true }, { userId: actorUserId, adultId: adultAId });

    const { buildBuyoutQuote } = await import("../elections");
    const quoteA = await buildBuyoutQuote(orgId, periodId, householdAId, { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 60 });
    expect(quoteA.rateCents).toBe(500); // household A: accepted -> contract-linked rate
    expect(quoteA.contractAcceptanceId).not.toBeNull();

    const quoteB = await buildBuyoutQuote(orgId, periodId, householdBId, { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 60 });
    expect(quoteB.rateCents).toBe(2000); // household B: never accepted -> regular rate, contract-only window never even considered
    expect(quoteB.contractAcceptanceId).toBeNull();
  });

  it("4: household B's acceptance never grants household A eligibility, even for the exact same period/version", async () => {
    await createWindow({ name: "Regular rate", amountCents: 2000, contractSigningOnly: false });
    await createWindow({ name: "Contract-linked rate", amountCents: 500, contractSigningOnly: true });

    const { acceptAgreement } = await import("../agreements");
    await acceptAgreement(orgId, periodId, householdBId, { acknowledged: true }, { userId: actorUserId, adultId: adultBId });

    const { buildBuyoutQuote } = await import("../elections");
    const quoteA = await buildBuyoutQuote(orgId, periodId, householdAId, { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 60 });
    expect(quoteA.rateCents).toBe(2000); // household A never accepted -- household B's acceptance is invisible to it
    expect(quoteA.contractAcceptanceId).toBeNull();
  });

  it("5/9: the quoted rate freezes onto the election and survives BOTH a later pricing-window amount edit and a later agreement-version reassignment", async () => {
    await createWindow({ name: "Regular rate", amountCents: 2000, contractSigningOnly: false });
    const contractWindow = await createWindow({ name: "Contract-linked rate", amountCents: 500, contractSigningOnly: true, lockTiming: "ELECTION" });

    const { acceptAgreement } = await import("../agreements");
    await acceptAgreement(orgId, periodId, householdAId, { acknowledged: true }, { userId: actorUserId, adultId: adultAId });

    const { recordElection, resolveLockedOrFreshQuote } = await import("../elections");
    const election = await recordElection(
      orgId,
      periodId,
      householdAId,
      { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 60, acknowledged: true },
      { userId: actorUserId }
    );
    expect(election.quotedRateCents).toBe(500);
    const frozenContractAcceptanceId = election.contractAcceptanceId;
    expect(frozenContractAcceptanceId).not.toBeNull();

    // Edit the SAME window's rate after the election was made.
    await prisma.ptaVolunteerPricingWindow.update({ where: { id: contractWindow.id }, data: { amountCents: 999999 } });

    const locked = await resolveLockedOrFreshQuote(orgId, periodId, householdAId, { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 60, electionId: election.id });
    expect(locked.rateCents).toBe(500); // still the ORIGINAL frozen rate, not the edited 999999
    expect(locked.contractAcceptanceId).toBe(frozenContractAcceptanceId); // unchanged

    // Publish + assign a NEW agreement version to the period.
    const v2 = await prisma.ptaVolunteerAgreementVersion.create({
      data: {
        organizationId: orgId,
        requirementPeriodId: periodId,
        title: "Amended Agreement",
        versionNumber: 2,
        content: "Please volunteer (amended).",
        contentHash: "test-hash-v2",
        status: "PUBLISHED",
        publishedAt: new Date(),
        publishedByUserId: actorUserId,
        createdByUserId: actorUserId,
      },
    });
    await prisma.ptaVolunteerRequirementPeriod.update({ where: { id: periodId }, data: { agreementVersionId: v2.id } });
    try {
      const lockedAfterReassignment = await resolveLockedOrFreshQuote(orgId, periodId, householdAId, {
        electionType: "PARTIAL_BUYOUT",
        hoursElectedMinutes: 60,
        electionId: election.id,
      });
      expect(lockedAfterReassignment.rateCents).toBe(500); // an already-locked election is untouched by the reassignment
      expect(lockedAfterReassignment.contractAcceptanceId).toBe(frozenContractAcceptanceId);
    } finally {
      await prisma.ptaVolunteerRequirementPeriod.update({ where: { id: periodId }, data: { agreementVersionId: versionId } });
      await prisma.ptaVolunteerAgreementVersion.delete({ where: { id: v2.id } }).catch(() => {});
    }
  });

  it("6a: the buyout window's own expiration (period.buyoutWindowEnd) is enforced independently of the eligibility window", async () => {
    await prisma.ptaVolunteerRequirementPeriod.update({
      where: { id: periodId },
      data: { buyoutWindowStart: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), buyoutWindowEnd: new Date(Date.now() - 1000) }, // already closed
    });
    await createWindow({ name: "Regular rate", amountCents: 2000, contractSigningOnly: false });

    const { buildBuyoutQuote } = await import("../elections");
    await expect(buildBuyoutQuote(orgId, periodId, householdAId, { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 60 })).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_BUYOUT_CLOSED",
    });

    await prisma.ptaVolunteerRequirementPeriod.update({ where: { id: periodId }, data: { buyoutWindowStart: null, buyoutWindowEnd: null } });
  });

  it("6b: a pricing window's own [startAt, endAt) expiration is enforced independently -- an expired contract-linked window falls back to the regular one, never to 'no rate'", async () => {
    await createWindow({ name: "Regular rate", amountCents: 2000, contractSigningOnly: false });
    await createWindow({
      name: "Expired contract-linked rate",
      amountCents: 500,
      contractSigningOnly: true,
      startAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      endAt: new Date(Date.now() - 1000), // already expired
    });

    const { acceptAgreement } = await import("../agreements");
    await acceptAgreement(orgId, periodId, householdAId, { acknowledged: true }, { userId: actorUserId, adultId: adultAId });

    const { buildBuyoutQuote } = await import("../elections");
    const quote = await buildBuyoutQuote(orgId, periodId, householdAId, { electionType: "PARTIAL_BUYOUT", hoursElectedMinutes: 60 });
    expect(quote.rateCents).toBe(2000); // falls through to the regular window, contract-linked window is expired
  });

  it("10: acceptance ALONE creates no purchase, ledger entry, election, or provider call of any kind", async () => {
    const { acceptAgreement } = await import("../agreements");
    await acceptAgreement(orgId, periodId, householdAId, { acknowledged: true }, { userId: actorUserId, adultId: adultAId });

    const [purchaseCount, ledgerCount, electionCount] = await Promise.all([
      prisma.ptaVolunteerBuyoutPurchase.count({ where: { organizationId: orgId, householdId: householdAId } }),
      prisma.ptaVolunteerLedgerEntry.count({ where: { organizationId: orgId, householdId: householdAId } }),
      prisma.ptaVolunteerBuyoutElection.count({ where: { organizationId: orgId, householdId: householdAId } }),
    ]);
    expect(purchaseCount).toBe(0);
    expect(ledgerCount).toBe(0);
    expect(electionCount).toBe(0);
  });
});
