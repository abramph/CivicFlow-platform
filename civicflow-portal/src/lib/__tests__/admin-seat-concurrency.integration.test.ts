import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database concurrency test for lockAndAssertAdminSeatAvailable
 * (CLOUD-SEAT-C) — deliberately NOT using a mocked Prisma client, mirroring
 * member-lifecycle-concurrency.integration.test.ts's structure and skip
 * convention. The mocked unit tests (organization-memberships-seat-
 * enforcement.test.ts) can only prove the code calls $queryRaw before
 * counting; they can't prove the SELECT ... FOR UPDATE lock actually makes
 * two genuinely simultaneous privilege-granting mutations against the same
 * org race-safe against real Postgres.
 *
 * Skipped by default (no live DB in a normal `vitest run`) -- run with
 * DATABASE_URL pointed at a disposable/local Postgres BEFORE starting vitest:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   ADMIN_SEAT_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/__tests__/admin-seat-concurrency.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.ADMIN_SEAT_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("admin-seats — real concurrency", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;
  const userIds: string[] = [];

  async function grantSeat(userId: string) {
    const { lockAndAssertAdminSeatAvailable } = await import("../admin-seats");
    return prisma.$transaction(async (tx: typeof prisma) => {
      await lockAndAssertAdminSeatAvailable(tx, orgId);
      return tx.organizationMembership.create({ data: { organizationId: orgId, userId, role: "STAFF" } });
    });
  }

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: {
        slug: `admin-seat-concurrency-${Date.now()}`,
        name: "Admin Seat Concurrency Test Org",
        primaryVertical: "PTA", // 10 included seats
      },
    });
    orgId = org.id;

    // Fill 9 of the 10 included seats with real STAFF memberships, leaving
    // exactly one seat available before the race.
    for (let i = 0; i < 9; i++) {
      const user = await prisma.user.create({
        data: { email: `admin-seat-filler-${Date.now()}-${i}@example.test`, passwordHash: "test-hash-not-real" },
      });
      userIds.push(user.id);
      await prisma.organizationMembership.create({ data: { organizationId: orgId, userId: user.id, role: "STAFF" } });
    }
  });

  afterAll(async () => {
    await prisma?.organizationMembership.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgId } }).catch(() => {});
    for (const id of userIds) {
      await prisma?.user.delete({ where: { id } }).catch(() => {});
    }
    await prisma?.$disconnect();
  });

  it("exactly one of two simultaneous seat-consuming grants wins when only one seat is available", async () => {
    const racer1 = await prisma.user.create({
      data: { email: `admin-seat-racer1-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" },
    });
    const racer2 = await prisma.user.create({
      data: { email: `admin-seat-racer2-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" },
    });
    userIds.push(racer1.id, racer2.id);

    const [r1, r2] = await Promise.allSettled([grantSeat(racer1.id), grantSeat(racer2.id)]);

    const succeeded = [r1, r2].filter((r) => r.status === "fulfilled");
    const failed = [r1, r2].filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    if (failed[0].status === "rejected") {
      expect((failed[0].reason as { code?: string }).code).toBe("ADMIN_SEAT_LIMIT_REACHED");
    }

    // The critical assertion: real Postgres state never exceeded 10, even
    // though both racers observed "1 seat available" if the lock didn't work.
    const { getAdminSeatSummary } = await import("../admin-seats");
    const summary = await getAdminSeatSummary(orgId);
    expect(summary.usedAdminSeats).toBe(10);
    expect(summary.availableAdminSeats).toBe(0);
  });
});
