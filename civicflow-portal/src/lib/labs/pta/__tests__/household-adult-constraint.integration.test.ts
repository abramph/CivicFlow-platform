import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database regression test for a critical bug caught during the
 * post-implementation hardening review: `PtaHouseholdAdult.userId` was
 * originally declared with a bare `@unique` (a GLOBAL unique constraint),
 * which made it impossible for the same user to ever be a household adult
 * in a second PTA organization — directly breaking the explicit multi-org
 * parent requirement. The fix is `@@unique([organizationId, userId])`.
 *
 * This is deliberately a real-database test, not a mocked unit test — a
 * mocked Prisma client can never catch a wrong constraint SCOPE, since the
 * mock doesn't enforce constraints at all. In fact, every existing mocked
 * unit test in this suite passed even while the migration had the bug,
 * which is exactly why this regression needs a real database to be
 * meaningful.
 *
 * Skipped by default — run with DATABASE_URL pointed at a disposable/local
 * Postgres BEFORE starting vitest, e.g.:
 *   DATABASE_URL="postgresql://postgres@localhost:55432/civicflow_disposable" \
 *   PTA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/labs/pta/__tests__/household-adult-constraint.integration.test.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.PTA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("PtaHouseholdAdult.userId uniqueness — must be scoped per-organization, not global", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let userId: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const user = await prisma.user.create({ data: { email: `pta-constraint-test-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    userId = user.id;

    const orgA = await prisma.organization.create({ data: { slug: `pta-constraint-test-a-${Date.now()}`, name: "Constraint Test Org A" } });
    const orgB = await prisma.organization.create({ data: { slug: `pta-constraint-test-b-${Date.now()}`, name: "Constraint Test Org B" } });
    orgAId = orgA.id;
    orgBId = orgB.id;
  });

  afterAll(async () => {
    await prisma?.organization.delete({ where: { id: orgAId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgBId } }).catch(() => {});
    await prisma?.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("allows the SAME user to be a household adult in TWO DIFFERENT organizations", async () => {
    const householdA = await prisma.ptaHousehold.create({ data: { organizationId: orgAId, displayName: "Household A", schoolYear: "2026-2027" } });
    const householdB = await prisma.ptaHousehold.create({ data: { organizationId: orgBId, displayName: "Household B", schoolYear: "2026-2027" } });

    const adultA = await prisma.ptaHouseholdAdult.create({ data: { organizationId: orgAId, householdId: householdA.id, name: "Multi-Org Parent", userId } });
    const adultB = await prisma.ptaHouseholdAdult.create({ data: { organizationId: orgBId, householdId: householdB.id, name: "Multi-Org Parent", userId } });

    expect(adultA.userId).toBe(userId);
    expect(adultB.userId).toBe(userId);
    expect(adultA.organizationId).not.toBe(adultB.organizationId);
  });

  it("still rejects a SECOND household-adult row for the SAME user within the SAME organization", async () => {
    const orgC = await prisma.organization.create({ data: { slug: `pta-constraint-test-c-${Date.now()}`, name: "Constraint Test Org C" } });
    const household1 = await prisma.ptaHousehold.create({ data: { organizationId: orgC.id, displayName: "Household 1", schoolYear: "2026-2027" } });
    const household2 = await prisma.ptaHousehold.create({ data: { organizationId: orgC.id, displayName: "Household 2", schoolYear: "2026-2027" } });

    await prisma.ptaHouseholdAdult.create({ data: { organizationId: orgC.id, householdId: household1.id, name: "Duplicate Attempt", userId } });

    let threw = false;
    try {
      await prisma.ptaHouseholdAdult.create({ data: { organizationId: orgC.id, householdId: household2.id, name: "Duplicate Attempt", userId } });
    } catch (e) {
      threw = true;
      expect((e as { code?: string }).code).toBe("P2002"); // Prisma unique-constraint violation
    }
    expect(threw).toBe(true);

    await prisma.organization.delete({ where: { id: orgC.id } });
  });
});
