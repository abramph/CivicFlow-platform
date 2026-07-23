import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database concurrency test — deliberately NOT using a mocked Prisma
 * client, unlike every other test in this suite. Mocked unit tests (see
 * volunteers.test.ts) can only prove the code *calls* the right conditional
 * UPDATE; they can't prove that pattern is actually race-safe under genuine
 * concurrent load. This test fires real concurrent claims against a real
 * Postgres instance and asserts exactly `capacity` succeed.
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run it with
 * DATABASE_URL already pointed at a disposable/local Postgres BEFORE
 * starting vitest, e.g.:
 *   DATABASE_URL="postgresql://postgres@localhost:55432/civicflow_disposable" \
 *     npx vitest run src/lib/labs/pta/__tests__/volunteers-concurrency.integration.test.ts
 * (setting process.env.DATABASE_URL inside this file would be too late —
 * src/lib/prisma.ts's client is a globalThis-cached singleton read once at
 * first import, which may already have happened via another test file in
 * the same worker). Never point this at a shared or production database;
 * it creates and deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.PTA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("claimPtaVolunteerSlot — real concurrent claims against a live Postgres instance", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let organizationId: string;
  let opportunityId: string;
  let slotId: string;
  let actorUserId: string;
  const adultIds: string[] = [];

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({ data: { slug: `pta-concurrency-test-${Date.now()}`, name: "PTA Concurrency Test Org" } });
    organizationId = org.id;

    // A real User row — claimPtaVolunteerSlot's audit event has a real FK to
    // User.id, so a fabricated actor id would fail with a constraint
    // violation before ever reaching the claim logic under test.
    const actor = await prisma.user.create({ data: { email: `pta-concurrency-actor-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    actorUserId = actor.id;

    const opportunity = await prisma.ptaVolunteerOpportunity.create({ data: { organizationId, title: "Concurrency Test Opportunity" } });
    opportunityId = opportunity.id;

    const slot = await prisma.ptaVolunteerSlot.create({ data: { organizationId, opportunityId, capacity: 3 } });
    slotId = slot.id;

    // 10 distinct household adults all racing for 3 seats.
    const household = await prisma.ptaHousehold.create({ data: { organizationId, displayName: "Concurrency Household", schoolYear: "2026-2027" } });
    for (let i = 0; i < 10; i++) {
      const adult = await prisma.ptaHouseholdAdult.create({ data: { organizationId, householdId: household.id, name: `Adult ${i}` } });
      adultIds.push(adult.id);
    }
  });

  afterAll(async () => {
    await prisma?.organization.delete({ where: { id: organizationId } }).catch(() => {});
    await prisma?.user.delete({ where: { id: actorUserId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("allows exactly `capacity` (3) concurrent claims to succeed and rejects the rest with no overbooking", async () => {
    const { claimPtaVolunteerSlot } = await import("../volunteers");

    const results = await Promise.allSettled(adultIds.map((adultId) => claimPtaVolunteerSlot(organizationId, slotId, adultId, actorUserId)));

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(succeeded).toHaveLength(3);
    expect(failed).toHaveLength(7);
    for (const failure of failed) {
      if (failure.status === "rejected") {
        expect(failure.reason).toMatchObject({ code: "PTA_SLOT_FULL" });
      }
    }

    // The slot's own claimedCount must exactly match reality — proving the
    // atomic UPDATE, not just the returned promises, stayed consistent.
    const finalSlot = await prisma.ptaVolunteerSlot.findUniqueOrThrow({ where: { id: slotId } });
    expect(finalSlot.claimedCount).toBe(3);

    const signupCount = await prisma.ptaVolunteerSignup.count({ where: { slotId, status: "SIGNED_UP" } });
    expect(signupCount).toBe(3);
  });
});
