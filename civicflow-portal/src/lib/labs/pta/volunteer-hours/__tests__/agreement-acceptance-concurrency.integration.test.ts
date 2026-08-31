import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * feature/pta-family-agreement-buyout — real-database concurrency proof for
 * PtaVolunteerAgreementAcceptance's unique constraint
 * (organizationId, householdId, agreementVersionId). Mocked unit tests
 * (agreements.test.ts) prove the code CALLS the right conditional queries
 * and correctly interprets a SIMULATED P2002 or a SIMULATED audit failure;
 * they cannot prove real Postgres actually blocks a second concurrent
 * insert, actually rolls back an in-flight transaction when the audit
 * insert fails, or that Prisma's error shape for this specific constraint
 * is what acceptAgreement's catch block expects. Mirrors
 * assessment-charge-dedupe-concurrency.integration.test.ts's structure and
 * skip convention exactly.
 *
 * feature/pta-family-agreement-buyout follow-up (FA3 §6) extended this file
 * to also cover, with real row/audit-event counts rather than just "it
 * collapsed to one row": two-adult-same-household races, cross-household
 * independence, a REAL forced-audit-failure rollback (via a thin wrapper
 * around the real `@/lib/audit` module -- see auditFailureQueue below --
 * not a fully mocked Prisma client, so the surrounding $transaction is
 * genuinely exercised against Postgres), and a successful retry
 * immediately afterward.
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

// FA3 §6: a queue of errors to throw on the NEXT createAuditEvent call(s)
// only -- every other call (setup, unrelated audits, retries) passes
// through to the real implementation, which writes a real AuditEvent row
// via whatever `tx` it's given. This lets a single test force the
// acceptAgreement transaction to fail AFTER the acceptance row's INSERT
// has already been issued but BEFORE commit, proving Postgres itself rolls
// the row back -- something a fully-mocked prisma client can never prove.
const auditFailureQueue: Error[] = [];
vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return {
    createAuditEvent: async (...args: Parameters<typeof actual.createAuditEvent>) => {
      const forced = auditFailureQueue.shift();
      if (forced) throw forced;
      return actual.createAuditEvent(...args);
    },
  };
});

describe.skipIf(!RUN_INTEGRATION)("PtaVolunteerAgreementAcceptance — real duplicate-acceptance concurrency", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;
  let householdId: string;
  let household2Id: string;
  let periodId: string;
  let versionId: string;
  let actorUserId: string;
  let adultId: string;
  let actor2UserId: string;
  let adult2Id: string;
  let actor3UserId: string;
  let adult3InHousehold2Id: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: { slug: `pta-agreement-concurrency-${Date.now()}`, name: "Agreement Concurrency Test PTA", primaryVertical: "PTA" },
    });
    orgId = org.id;

    const actor = await prisma.user.create({ data: { email: `agreement-actor-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    actorUserId = actor.id;
    const actor2 = await prisma.user.create({ data: { email: `agreement-actor2-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    actor2UserId = actor2.id;
    const actor3 = await prisma.user.create({ data: { email: `agreement-actor3-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    actor3UserId = actor3.id;

    const household = await prisma.ptaHousehold.create({
      data: { organizationId: orgId, displayName: "Test Household", status: "ACTIVE", schoolYear: "2026-2027" },
    });
    householdId = household.id;
    const household2 = await prisma.ptaHousehold.create({
      data: { organizationId: orgId, displayName: "Second Test Household", status: "ACTIVE", schoolYear: "2026-2027" },
    });
    household2Id = household2.id;

    const adult = await prisma.ptaHouseholdAdult.create({
      data: { organizationId: orgId, householdId, userId: actorUserId, name: "Test Parent" },
    });
    adultId = adult.id;
    const adult2 = await prisma.ptaHouseholdAdult.create({
      data: { organizationId: orgId, householdId, userId: actor2UserId, name: "Second Parent, Same Household" },
    });
    adult2Id = adult2.id;
    const adult3 = await prisma.ptaHouseholdAdult.create({
      data: { organizationId: orgId, householdId: household2Id, userId: actor3UserId, name: "Parent In Household 2" },
    });
    adult3InHousehold2Id = adult3.id;

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

  beforeEach(() => {
    auditFailureQueue.length = 0;
  });

  afterEach(async () => {
    await prisma?.ptaVolunteerAgreementAcceptance.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.auditEvent.deleteMany({ where: { organizationId: orgId, resource: "pta_volunteer_agreement_acceptance" } }).catch(() => {});
  });

  afterAll(async () => {
    await prisma?.ptaVolunteerRequirementPeriod.update({ where: { id: periodId }, data: { agreementVersionId: null } }).catch(() => {});
    await prisma?.ptaVolunteerAgreementVersion.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaVolunteerRequirementPeriod.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaHouseholdAdult.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaHousehold.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma?.user.deleteMany({ where: { id: { in: [actorUserId, actor2UserId, actor3UserId] } } }).catch(() => {});
    await prisma?.$disconnect();
  });

  async function auditCountFor(targetHouseholdId: string) {
    return prisma.auditEvent.count({
      where: {
        organizationId: orgId,
        resource: "pta_volunteer_agreement_acceptance",
        action: "pta.volunteer_hours.agreement_accepted",
        after: { path: ["householdId"], equals: targetHouseholdId },
      },
    });
  }

  it("real concurrency: 2 simultaneous acceptance submissions produce exactly one acceptance row AND exactly one audit event", async () => {
    const { acceptAgreement } = await import("../agreements");
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () => acceptAgreement(orgId, periodId, householdId, { acknowledged: true }, { userId: actorUserId, adultId }))
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true); // no unhandled unique-constraint error escaped either call
    const ids = new Set((results as PromiseFulfilledResult<{ id: string }>[]).map((r) => r.value.id));
    expect(ids.size).toBe(1); // both calls resolved to the SAME acceptance row (the loser got the winner's existing row, not an error)

    const count = await prisma.ptaVolunteerAgreementAcceptance.count({ where: { organizationId: orgId, householdId, agreementVersionId: versionId } });
    expect(count).toBe(1);
    expect(await auditCountFor(householdId)).toBe(1);
  });

  it("real concurrency: 10 simultaneous acceptance submissions produce exactly one acceptance row AND exactly one audit event", async () => {
    const { acceptAgreement } = await import("../agreements");
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => acceptAgreement(orgId, periodId, householdId, { acknowledged: true }, { userId: actorUserId, adultId }))
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const ids = new Set((results as PromiseFulfilledResult<{ id: string }>[]).map((r) => r.value.id));
    expect(ids.size).toBe(1);

    const count = await prisma.ptaVolunteerAgreementAcceptance.count({ where: { organizationId: orgId, householdId, agreementVersionId: versionId } });
    expect(count).toBe(1);
    expect(await auditCountFor(householdId)).toBe(1);
  });

  it("sequential retry after the first acceptance also resolves to the same row -- repeated submission after success creates neither another row nor another audit event", async () => {
    const { acceptAgreement } = await import("../agreements");
    const first = await acceptAgreement(orgId, periodId, householdId, { acknowledged: true }, { userId: actorUserId, adultId });
    const second = await acceptAgreement(orgId, periodId, householdId, { acknowledged: true }, { userId: actorUserId, adultId });
    expect(second.id).toBe(first.id);
    const count = await prisma.ptaVolunteerAgreementAcceptance.count({ where: { organizationId: orgId, householdId, agreementVersionId: versionId } });
    expect(count).toBe(1);
    expect(await auditCountFor(householdId)).toBe(1);
  });

  it("FA3 §6: two DIFFERENT authorized adults in the same household racing still produce exactly one household acceptance", async () => {
    const { acceptAgreement } = await import("../agreements");
    const results = await Promise.allSettled([
      acceptAgreement(orgId, periodId, householdId, { acknowledged: true }, { userId: actorUserId, adultId }),
      acceptAgreement(orgId, periodId, householdId, { acknowledged: true }, { userId: actor2UserId, adultId: adult2Id }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const ids = new Set((results as PromiseFulfilledResult<{ id: string }>[]).map((r) => r.value.id));
    expect(ids.size).toBe(1); // the household's acceptance is one record regardless of WHICH adult raced to submit it

    const count = await prisma.ptaVolunteerAgreementAcceptance.count({ where: { organizationId: orgId, householdId, agreementVersionId: versionId } });
    expect(count).toBe(1);
    expect(await auditCountFor(householdId)).toBe(1);
  });

  it("FA3 §6: cross-household submissions remain fully independent -- household A's race never blocks or merges with household B's", async () => {
    const { acceptAgreement } = await import("../agreements");
    const results = await Promise.allSettled([
      acceptAgreement(orgId, periodId, householdId, { acknowledged: true }, { userId: actorUserId, adultId }),
      acceptAgreement(orgId, periodId, householdId, { acknowledged: true }, { userId: actorUserId, adultId }),
      acceptAgreement(orgId, periodId, household2Id, { acknowledged: true }, { userId: actor3UserId, adultId: adult3InHousehold2Id }),
      acceptAgreement(orgId, periodId, household2Id, { acknowledged: true }, { userId: actor3UserId, adultId: adult3InHousehold2Id }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const countHousehold1 = await prisma.ptaVolunteerAgreementAcceptance.count({
      where: { organizationId: orgId, householdId, agreementVersionId: versionId },
    });
    const countHousehold2 = await prisma.ptaVolunteerAgreementAcceptance.count({
      where: { organizationId: orgId, householdId: household2Id, agreementVersionId: versionId },
    });
    expect(countHousehold1).toBe(1);
    expect(countHousehold2).toBe(1);
    expect(await auditCountFor(householdId)).toBe(1);
    expect(await auditCountFor(household2Id)).toBe(1);

    await prisma.ptaVolunteerAgreementAcceptance.deleteMany({ where: { organizationId: orgId, householdId: household2Id } });
    await prisma.auditEvent.deleteMany({ where: { organizationId: orgId, resource: "pta_volunteer_agreement_acceptance" } });
  });

  it("FA3 §6: a forced audit-insertion failure rolls back the acceptance row (real Postgres, not a mocked client) -- and a retry immediately afterward succeeds exactly once", async () => {
    const auditFailure = new Error("audit sink unavailable (forced for this test)");
    auditFailureQueue.push(auditFailure);

    const { acceptAgreement } = await import("../agreements");
    await expect(
      acceptAgreement(orgId, periodId, householdId, { acknowledged: true }, { userId: actorUserId, adultId })
    ).rejects.toBe(auditFailure);

    // Real Postgres proof: the acceptance INSERT was issued inside the same
    // $transaction as the failed audit insert, so it must have been rolled
    // back along with it -- zero rows, zero audit events, not "the audit
    // event is just missing while the acceptance silently persisted."
    const countAfterFailure = await prisma.ptaVolunteerAgreementAcceptance.count({
      where: { organizationId: orgId, householdId, agreementVersionId: versionId },
    });
    expect(countAfterFailure).toBe(0);
    expect(await auditCountFor(householdId)).toBe(0);

    // Retry after rollback succeeds once -- no failure queued this time.
    const retry = await acceptAgreement(orgId, periodId, householdId, { acknowledged: true }, { userId: actorUserId, adultId });
    expect(retry.id).toBeTruthy();

    const countAfterRetry = await prisma.ptaVolunteerAgreementAcceptance.count({
      where: { organizationId: orgId, householdId, agreementVersionId: versionId },
    });
    expect(countAfterRetry).toBe(1);
    expect(await auditCountFor(householdId)).toBe(1);
  });
});
