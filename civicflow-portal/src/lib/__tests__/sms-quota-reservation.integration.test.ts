import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database concurrency regression suite for reserveSmsAllowance() /
 * releaseSmsAllowance() and getSmsEntitlement()'s rollover behavior —
 * deliberately NOT a mocked-Prisma test, because every property under test
 * is one mocks cannot express:
 *
 *  - the conditional UPDATE's row lock makes the monthly quota a strict
 *    hard stop under concurrent senders (the campaign dispatcher runs
 *    recipients 20-wide);
 *  - the reservation token binds a release to the EXACT billing period the
 *    unit was charged in, so a stale old-period release can never erase a
 *    newer period's successful send;
 *  - a NULL-period legacy row is defensively initialized instead of being
 *    reservable forever with no rollover;
 *  - concurrent entitlement checks during a rollover never strand capacity.
 *
 * Both Twilio call sites — initial sends (sms-service.ts) and retry/cron
 * (sms-queue.ts) — claim through this same primitive immediately before
 * sendSms(), which the unit suites pin; this file proves the primitive.
 *
 * Runs in CI inside the isolated-Postgres job (.github/workflows/
 * pr-validation.yml) against that job's throwaway container. Locally:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   HOA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/__tests__/sms-quota-reservation.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows (and temporarily flips the PlatformSmsSettings
 * orgMessagingEnabled flag, restoring it afterwards).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.HOA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("reserveSmsAllowance — real-database hard-stop concurrency", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;

  const futureEnd = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  async function setUsage(used: number, periodEnd: Date | null, periodStart: Date | null = new Date()) {
    await prisma.organizationSmsSettings.update({
      where: { organizationId: orgId },
      data: { smsUsedThisPeriod: used, smsBillingPeriodEnd: periodEnd, smsBillingPeriodStart: periodStart },
    });
  }

  async function readRow(): Promise<{ used: number; periodStart: Date | null; periodEnd: Date | null }> {
    const row = await prisma.organizationSmsSettings.findUnique({ where: { organizationId: orgId } });
    return { used: row.smsUsedThisPeriod, periodStart: row.smsBillingPeriodStart, periodEnd: row.smsBillingPeriodEnd };
  }

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: {
        slug: `sms-quota-reservation-${Date.now()}`,
        name: "SMS Quota Reservation Test Org",
        primaryVertical: "COMMUNITY",
        billingExempt: true,
      },
    });
    orgId = org.id;
    await prisma.organizationSmsSettings.create({
      data: {
        organizationId: orgId,
        smsAddOnActive: true,
        smsMonthlyLimit: 1000,
        smsUsedThisPeriod: 0,
        smsBillingPeriodStart: new Date(),
        smsBillingPeriodEnd: futureEnd(),
      },
    });
  });

  afterAll(async () => {
    await prisma?.organizationSmsSettings.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("EXACT BOUNDARY: at 999/1000 used, 20 concurrent reservations grant exactly ONE — the other 19 fail closed", async () => {
    const { reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    await setUsage(999, futureEnd());

    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveSmsAllowance(orgId))
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(19);
    expect((await readRow()).used).toBe(1000); // never oversubscribed
  });

  it("N remaining, more-than-N racers: exactly N reservations succeed", async () => {
    const { reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    await setUsage(990, futureEnd());

    const results = await Promise.all(
      Array.from({ length: 30 }, () => reserveSmsAllowance(orgId))
    );

    expect(results.filter(Boolean)).toHaveLength(10);
    expect((await readRow()).used).toBe(1000);
  });

  it("an exhausted allowance refuses every concurrent reservation", async () => {
    const { reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    await setUsage(1000, futureEnd());

    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveSmsAllowance(orgId))
    );

    expect(results.every((r) => r === null)).toBe(true);
    expect((await readRow()).used).toBe(1000);
  });

  it("PERIOD-SAFE RELEASE: a failed old-period reservation cannot erase a new period's successful send or reopen capacity", async () => {
    const { releaseSmsAllowance, reserveSmsAllowance } = await import("@/lib/sms-entitlement");

    // 1. Reserve one unit in period A.
    await setUsage(0, futureEnd());
    const reservationA = await reserveSmsAllowance(orgId);
    expect(reservationA).not.toBeNull();
    expect((await readRow()).used).toBe(1);

    // 2. Roll into period B (simulate period A elapsing) …
    const rowA = await readRow();
    await setUsage(rowA.used, new Date(Date.now() - 60_000), rowA.periodStart);
    // 3. … and reserve a SUCCESSFUL unit in period B (rollover-and-claim).
    const reservationB = await reserveSmsAllowance(orgId);
    expect(reservationB).not.toBeNull();
    const afterB = await readRow();
    expect(afterB.used).toBe(1); // unit #1 of period B
    expect(afterB.periodEnd!.getTime()).not.toBe(reservationA!.periodEnd!.getTime());

    // 4. The old request's Twilio failure now releases reservation A.
    await releaseSmsAllowance(reservationA!);

    // 5+6. Period B still shows exactly one used unit — the stale release
    // affected zero rows, no extra capacity was created.
    expect((await readRow()).used).toBe(1);

    // A matching same-period release still works normally.
    await releaseSmsAllowance(reservationB!);
    expect((await readRow()).used).toBe(0);
  });

  it("release with a matching current-period token returns the unit for re-reservation (synchronous Twilio failure path)", async () => {
    const { releaseSmsAllowance, reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    await setUsage(999, futureEnd());

    const reservation = await reserveSmsAllowance(orgId);
    expect(reservation).not.toBeNull();
    expect((await readRow()).used).toBe(1000);

    await releaseSmsAllowance(reservation!);
    expect((await readRow()).used).toBe(999);

    await expect(reserveSmsAllowance(orgId)).resolves.not.toBeNull();
    expect((await readRow()).used).toBe(1000);
  });

  it("release never drives usage below zero, even with a matching token", async () => {
    const { releaseSmsAllowance, reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    await setUsage(999, futureEnd());
    const reservation = await reserveSmsAllowance(orgId);
    await releaseSmsAllowance(reservation!);
    // Second release of the same token: usage already returned; guarded.
    await setUsage(0, (await readRow()).periodEnd, (await readRow()).periodStart);
    await releaseSmsAllowance(reservation!);
    expect((await readRow()).used).toBe(0);
  });

  it("an elapsed billing period atomically rolls over inside the reservation itself — claims unit #1 of the new period, no reset/reserve race window", async () => {
    const { reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    await setUsage(1000, new Date(Date.now() - 60_000)); // exhausted AND elapsed

    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveSmsAllowance(orgId))
    );

    // Exactly one racer performs the rollover-and-claim (used becomes 1);
    // the rest then reserve normally against the fresh period.
    expect(results.filter(Boolean)).toHaveLength(20);
    const { used, periodEnd } = await readRow();
    expect(used).toBe(20);
    expect(periodEnd && periodEnd.getTime()).toBeGreaterThan(Date.now());
  });

  it("DEFENSIVE INIT: a legacy row with NULL period columns is initialized as a fresh month and claimed as unit #1 — never reservable forever without rollover", async () => {
    const { reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    await setUsage(5, null, null); // legacy shape: usage but no period

    const reservation = await reserveSmsAllowance(orgId);

    expect(reservation).not.toBeNull();
    expect(reservation!.periodStart).not.toBeNull();
    expect(reservation!.periodEnd).not.toBeNull();
    const row = await readRow();
    expect(row.used).toBe(1); // fresh period, unit #1
    expect(row.periodEnd!.getTime()).toBeGreaterThan(Date.now());
  });

  it("EXEMPT ENROLLMENT SHAPE: a freshly initialized enrollment (as the super-admin route writes it) consumes unit 1, then rolls correctly when the period elapses", async () => {
    const { reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    // Exactly what a genuine activation writes: zeroed usage + fresh window.
    const enrollStart = new Date();
    const enrollEnd = new Date(enrollStart);
    enrollEnd.setMonth(enrollEnd.getMonth() + 1);
    await setUsage(0, enrollEnd, enrollStart);

    const first = await reserveSmsAllowance(orgId);
    expect(first).not.toBeNull();
    const afterFirst = await readRow();
    expect(afterFirst.used).toBe(1);
    // Charged into the enrollment period, not a re-initialized one.
    expect(first!.periodEnd!.getTime()).toBe(enrollEnd.getTime());

    // Period elapses → next reservation rolls into a new month cleanly.
    await setUsage(afterFirst.used, new Date(Date.now() - 60_000), enrollStart);
    const second = await reserveSmsAllowance(orgId);
    expect(second).not.toBeNull();
    const afterSecond = await readRow();
    expect(afterSecond.used).toBe(1);
    expect(afterSecond.periodEnd!.getTime()).toBeGreaterThan(Date.now());
  });

  it("a zero-limit settings row can never reserve — elapsed, NULL-period, or current", async () => {
    const { reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    await prisma.organizationSmsSettings.update({
      where: { organizationId: orgId },
      data: { smsMonthlyLimit: 0, smsUsedThisPeriod: 0, smsBillingPeriodEnd: new Date(Date.now() - 60_000) },
    });
    await expect(reserveSmsAllowance(orgId)).resolves.toBeNull();

    await setUsage(0, null, null);
    await expect(reserveSmsAllowance(orgId)).resolves.toBeNull();

    // restore for any later cases
    await prisma.organizationSmsSettings.update({
      where: { organizationId: orgId },
      data: { smsMonthlyLimit: 1000, smsBillingPeriodEnd: futureEnd(), smsBillingPeriodStart: new Date() },
    });
  });

  it("ROLLOVER BOUNDARY: concurrent entitlement checks during a rollover never strand available capacity — every check sees the fresh period", async () => {
    const { getSmsEntitlement } = await import("@/lib/sms-entitlement");

    // getSmsEntitlement consults the PlatformSmsSettings singleton; flip
    // orgMessagingEnabled on for the duration and restore it afterwards
    // (created rows in the CI throwaway DB just get left to the job teardown,
    // but a pre-existing local row is restored to its prior value).
    const existing = await prisma.platformSmsSettings.findFirst();
    const previous = existing?.orgMessagingEnabled;
    if (existing) {
      await prisma.platformSmsSettings.update({ where: { id: existing.id }, data: { orgMessagingEnabled: true } });
    } else {
      await prisma.platformSmsSettings.create({ data: { orgMessagingEnabled: true } });
    }

    try {
      // At the limit AND elapsed: the stale reading says "denied", but the
      // rollover means a full fresh allowance actually exists.
      await setUsage(1000, new Date(Date.now() - 60_000));

      const results = await Promise.all(
        Array.from({ length: 5 }, () => getSmsEntitlement(orgId))
      );

      // One check wins the rollover CAS; the losers refetch the winner's
      // reset counter. Nobody may falsely report the allowance as used up.
      expect(results.every((r) => r.allowed)).toBe(true);
      const row = await readRow();
      expect(row.used).toBe(0);
      expect(row.periodEnd!.getTime()).toBeGreaterThan(Date.now());
    } finally {
      const current = await prisma.platformSmsSettings.findFirst();
      if (current && existing) {
        await prisma.platformSmsSettings.update({ where: { id: current.id }, data: { orgMessagingEnabled: previous } });
      } else if (current && !existing) {
        await prisma.platformSmsSettings.delete({ where: { id: current.id } }).catch(() => {});
      }
    }
  });
});
