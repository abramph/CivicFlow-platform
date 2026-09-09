import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database concurrency regression test for reserveSmsAllowance() /
 * releaseSmsAllowance() — deliberately NOT a mocked-Prisma test, because the
 * property under test is precisely the one mocks cannot express: that the
 * conditional UPDATE's row lock makes the monthly quota a strict hard stop
 * under concurrent senders. The campaign dispatcher runs recipients 20-wide;
 * with a read-check-then-increment design every racer can pass the check
 * before any increment lands (the defect this replaces). Both Twilio call
 * sites — initial sends (sms-service.ts) and retry/cron
 * (sms-queue.ts) — claim through this same primitive immediately before
 * sendSms(), which the unit suites pin; this file proves the primitive.
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run with:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   HOA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/__tests__/sms-quota-reservation.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.HOA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("reserveSmsAllowance — real-database hard-stop concurrency", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;

  const futureEnd = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  async function setUsage(used: number, periodEnd: Date) {
    await prisma.organizationSmsSettings.update({
      where: { organizationId: orgId },
      data: { smsUsedThisPeriod: used, smsBillingPeriodEnd: periodEnd, smsBillingPeriodStart: new Date() },
    });
  }

  async function readUsage(): Promise<{ used: number; periodEnd: Date | null }> {
    const row = await prisma.organizationSmsSettings.findUnique({ where: { organizationId: orgId } });
    return { used: row.smsUsedThisPeriod, periodEnd: row.smsBillingPeriodEnd };
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
    expect(results.filter((r) => !r)).toHaveLength(19);
    expect((await readUsage()).used).toBe(1000); // never oversubscribed
  });

  it("N remaining, more-than-N racers: exactly N reservations succeed", async () => {
    const { reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    await setUsage(990, futureEnd());

    const results = await Promise.all(
      Array.from({ length: 30 }, () => reserveSmsAllowance(orgId))
    );

    expect(results.filter(Boolean)).toHaveLength(10);
    expect((await readUsage()).used).toBe(1000);
  });

  it("an exhausted allowance refuses every concurrent reservation", async () => {
    const { reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    await setUsage(1000, futureEnd());

    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveSmsAllowance(orgId))
    );

    expect(results.every((r) => r === false)).toBe(true);
    expect((await readUsage()).used).toBe(1000);
  });

  it("release returns a unit that can be re-reserved (synchronous Twilio failure path)", async () => {
    const { releaseSmsAllowance, reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    await setUsage(1000, futureEnd());

    await releaseSmsAllowance(orgId);
    expect((await readUsage()).used).toBe(999);

    await expect(reserveSmsAllowance(orgId)).resolves.toBe(true);
    expect((await readUsage()).used).toBe(1000);
  });

  it("release never drives usage below zero", async () => {
    const { releaseSmsAllowance } = await import("@/lib/sms-entitlement");
    await setUsage(0, futureEnd());

    await releaseSmsAllowance(orgId);
    expect((await readUsage()).used).toBe(0);
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
    const { used, periodEnd } = await readUsage();
    expect(used).toBe(20);
    expect(periodEnd && periodEnd.getTime()).toBeGreaterThan(Date.now());
  });

  it("a zero-limit settings row can never reserve, even across a rollover", async () => {
    const { reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    await prisma.organizationSmsSettings.update({
      where: { organizationId: orgId },
      data: { smsMonthlyLimit: 0, smsUsedThisPeriod: 0, smsBillingPeriodEnd: new Date(Date.now() - 60_000) },
    });

    await expect(reserveSmsAllowance(orgId)).resolves.toBe(false);

    // restore for any later cases
    await prisma.organizationSmsSettings.update({
      where: { organizationId: orgId },
      data: { smsMonthlyLimit: 1000, smsBillingPeriodEnd: futureEnd() },
    });
  });
});
