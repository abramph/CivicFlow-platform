import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * feature/pta-family-agreement-buyout — real-database concurrency proof for
 * PtaVolunteerAgreementAcceptance's unique constraint
 * (organizationId, householdId, agreementVersionId). Mocked unit tests
 * (agreements.test.ts) prove the code CALLS the right conditional queries
 * and correctly interprets a SIMULATED P2002; they cannot prove real
 * Postgres actually blocks a second concurrent insert, or that Prisma's
 * error shape for this specific constraint is what
 * acceptAgreement's catch block expects. Mirrors
 * assessment-charge-dedupe-concurrency.integration.test.ts's structure and
 * skip convention exactly.
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run with:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   PTA_AGREEMENT_ACCEPTANCE_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/labs/pta/volunteer-hours/__tests__/agreement-acceptance-concurrency.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.PTA_AGREEMENT_ACCEPTANCE_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("PtaVolunteerAgreementAcceptance — real duplicate-acceptance concurrency", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;
  let householdId: string;
  let periodId: string;
  let versionId: string;
  let actorUserId: string;
  let adultId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: { slug: `pta-agreement-concurrency-${Date.now()}`, name: "Agreement Concurrency Test PTA", primaryVertical: "PTA" },
    });
    orgId = org.id;

    const actor = await prisma.user.create({ data: { email: `agreement-actor-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    actorUserId = actor.id;

    const household = await prisma.ptaHousehold.create({
      data: { organizationId: orgId, displayName: "Test Household", status: "ACTIVE", schoolYear: "2026-2027" },
    });
    householdId = household.id;

    const adult = await prisma.ptaHouseholdAdult.create({
      data: { organizationId: orgId, householdId, userId: actorUserId, name: "Test Parent" },
    });
    adultId = adult.id;

    const now = new Date();
    const period = await prisma.ptaVolunteerRequirementPeriod.create({
      data: {
        organizationId: orgId,
        name: "Agreement Concurrency Test Period",
        periodType: "SCHOOL_YEAR",
        startsOn: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        endsOn: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        timezone: "America/New_York",
        requiredMinutesDefault: 600,
        status: "ACTIVE",
      },
    });
    periodId = period.id;

    const version = await prisma.ptaVolunteerAgreementVersion.create({
      data: {
        organizationId: orgId,
        requirementPeriodId: periodId,
        title: "Test Agreement",
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
  });

  beforeEach(() => {});

  afterEach(async () => {
    await prisma?.ptaVolunteerAgreementAcceptance.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
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

  it("real concurrency: 2 simultaneous acceptance submissions produce exactly one acceptance row", async () => {
    const { acceptAgreement } = await import("../agreements");
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () => acceptAgreement(orgId, periodId, householdId, { acknowledged: true }, { userId: actorUserId, adultId }))
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const ids = new Set((results as PromiseFulfilledResult<{ id: string }>[]).map((r) => r.value.id));
    expect(ids.size).toBe(1); // both calls resolved to the SAME acceptance row

    const count = await prisma.ptaVolunteerAgreementAcceptance.count({ where: { organizationId: orgId, householdId, agreementVersionId: versionId } });
    expect(count).toBe(1);
  });

  it("real concurrency: 10 simultaneous acceptance submissions produce exactly one acceptance row", async () => {
    const { acceptAgreement } = await import("../agreements");
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => acceptAgreement(orgId, periodId, householdId, { acknowledged: true }, { userId: actorUserId, adultId }))
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const ids = new Set((results as PromiseFulfilledResult<{ id: string }>[]).map((r) => r.value.id));
    expect(ids.size).toBe(1);

    const count = await prisma.ptaVolunteerAgreementAcceptance.count({ where: { organizationId: orgId, householdId, agreementVersionId: versionId } });
    expect(count).toBe(1);
  });

  it("sequential retry after the first acceptance also resolves to the same row (idempotent, not just concurrency-safe)", async () => {
    const { acceptAgreement } = await import("../agreements");
    const first = await acceptAgreement(orgId, periodId, householdId, { acknowledged: true }, { userId: actorUserId, adultId });
    const second = await acceptAgreement(orgId, periodId, householdId, { acknowledged: true }, { userId: actorUserId, adultId });
    expect(second.id).toBe(first.id);
    const count = await prisma.ptaVolunteerAgreementAcceptance.count({ where: { organizationId: orgId, householdId, agreementVersionId: versionId } });
    expect(count).toBe(1);
  });
});
