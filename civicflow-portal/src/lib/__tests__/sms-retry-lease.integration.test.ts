import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database concurrency suite for the Round-4 single-owner retry lease
 * (claimSmsRetryAttempt) and the one-time attempt finalization that gates
 * allowance release (lib/sms-attempt-finalization.ts). Everything here is a
 * property mocks cannot prove:
 *
 *  - N racers (manual Retry route and cron sweeps both funnel through the
 *    same claimant) yield exactly ONE lease owner per attempt, and exactly
 *    one retryCount increment per won claim;
 *  - a live lease blocks every other worker; an expired lease admits
 *    exactly one recovery claimant;
 *  - a stale worker whose lease was recovered can neither overwrite the
 *    recovered attempt's terminal result nor release quota;
 *  - a single failed attempt returns at most ONE allowance unit, replays
 *    release nothing, and can never erase a unit consumed by a different
 *    successful attempt in the same period.
 *
 * Runs in CI inside the isolated-Postgres job (.github/workflows/
 * pr-validation.yml). Locally:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   HOA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/__tests__/sms-retry-lease.integration.test.ts
 * Never point this at a shared or production database. No Twilio call can
 * occur: the only end-to-end case uses an unnormalizable phone number, so
 * authorization denies before sendSms on every environment.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.HOA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("SMS retry lease + one-time finalization — real database", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;

  const futureEnd = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  async function createRetryRow(overrides: Record<string, unknown> = {}) {
    return prisma.smsMessage.create({
      data: {
        organizationId: orgId,
        phone: "+15551234567",
        body: "lease test",
        status: "RETRYING",
        nextRetryAt: new Date(Date.now() - 1000),
        retryCount: 0,
        ...overrides,
      },
    });
  }

  async function usage(): Promise<number> {
    const row = await prisma.organizationSmsSettings.findUnique({ where: { organizationId: orgId } });
    return row.smsUsedThisPeriod;
  }

  async function resetUsage(used: number) {
    await prisma.organizationSmsSettings.update({
      where: { organizationId: orgId },
      data: { smsUsedThisPeriod: used, smsBillingPeriodStart: new Date(), smsBillingPeriodEnd: futureEnd() },
    });
  }

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: {
        slug: `sms-retry-lease-${Date.now()}`,
        name: "SMS Retry Lease Test Org",
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
    await prisma?.smsMessage.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.organizationSmsSettings.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("SINGLE OWNER: 10 concurrent claims (manual + overlapping cron sweeps all use this CAS) grant exactly one lease and ONE retryCount increment", async () => {
    const { claimSmsRetryAttempt } = await import("@/lib/sms-queue");
    const row = await createRetryRow();

    const results = await Promise.all(Array.from({ length: 10 }, () => claimSmsRetryAttempt(row.id)));

    expect(results.filter(Boolean)).toHaveLength(1);
    const after = await prisma.smsMessage.findUnique({ where: { id: row.id } });
    expect(after.status).toBe("SENDING");
    expect(after.retryCount).toBe(1); // once per claimed attempt, not per competing request
    expect(after.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("a live lease blocks every other worker completely", async () => {
    const { claimSmsRetryAttempt } = await import("@/lib/sms-queue");
    const row = await createRetryRow();

    const first = await claimSmsRetryAttempt(row.id);
    expect(first).not.toBeNull();

    await expect(claimSmsRetryAttempt(row.id)).resolves.toBeNull();
    const after = await prisma.smsMessage.findUnique({ where: { id: row.id } });
    expect(after.retryCount).toBe(1);
  });

  it("CRASH RECOVERY: once the lease has expired, exactly one of several concurrent recovery workers claims the SENDING row", async () => {
    const { claimSmsRetryAttempt } = await import("@/lib/sms-queue");
    const row = await createRetryRow();

    // Simulated crash: the worker claims (leaseMs < 0 mints an already-
    // expired lease with the exact stored value) and then dies.
    const crashed = await claimSmsRetryAttempt(row.id, -60_000);
    expect(crashed).not.toBeNull();

    const recoveries = await Promise.all(Array.from({ length: 5 }, () => claimSmsRetryAttempt(row.id)));

    expect(recoveries.filter(Boolean)).toHaveLength(1);
    const after = await prisma.smsMessage.findUnique({ where: { id: row.id } });
    expect(after.status).toBe("SENDING");
    expect(after.retryCount).toBe(2); // crashed claim + recovery claim
    expect(after.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("FENCING: a stale worker can neither release quota nor overwrite the recovered worker's terminal result", async () => {
    const { claimSmsRetryAttempt } = await import("@/lib/sms-queue");
    const { finalizeSmsAttemptFailure, finalizeSmsAttemptSuccess } = await import("@/lib/sms-attempt-finalization");
    const { reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    await resetUsage(0);
    const row = await createRetryRow();

    // Worker A claims with an instantly-expired lease (its exact value IS
    // stored) and reserves a unit, then stalls past its lease.
    const staleLease = await claimSmsRetryAttempt(row.id, -60_000);
    const staleClaim = { kind: "retry", messageId: row.id, leaseExpiry: staleLease!.leaseExpiry } as const;
    const staleReservation = await reserveSmsAllowance(orgId);
    expect(await usage()).toBe(1);

    // Worker B recovers the row under a new lease.
    const recoveredLease = await claimSmsRetryAttempt(row.id);
    expect(recoveredLease).not.toBeNull();
    const recoveredClaim = { kind: "retry", messageId: row.id, leaseExpiry: recoveredLease!.leaseExpiry } as const;

    // Stale A tries to finalize its failure WITH its reservation: the fence
    // (status SENDING + A's exact lease value) matches nothing — no status
    // write, and crucially NO release.
    await expect(finalizeSmsAttemptFailure(staleClaim, staleReservation, "stale failure")).resolves.toBe(false);
    expect(await usage()).toBe(1); // A's unit stays conservatively consumed

    // B commits success under its own lease.
    await expect(finalizeSmsAttemptSuccess(recoveredClaim, { providerMessageId: "SMrecovered" })).resolves.toBe(true);
    const afterB = await prisma.smsMessage.findUnique({ where: { id: row.id } });
    expect(afterB.status).toBe("SENT");
    expect(afterB.providerMessageId).toBe("SMrecovered");
    expect(afterB.nextRetryAt).toBeNull();

    // Stale A tries again, both ways — the terminal result is untouchable.
    await expect(finalizeSmsAttemptSuccess(staleClaim, { providerMessageId: "SMstale" })).resolves.toBe(false);
    await expect(finalizeSmsAttemptFailure(staleClaim, staleReservation, "stale again")).resolves.toBe(false);
    const final = await prisma.smsMessage.findUnique({ where: { id: row.id } });
    expect(final.status).toBe("SENT");
    expect(final.providerMessageId).toBe("SMrecovered");
    expect(await usage()).toBe(1);
  });

  it("END-TO-END RACE: two workers race executeClaimedSmsRetry for one row — exactly one claims; no Twilio call is possible (unnormalizable phone denies in authorization)", async () => {
    const { executeClaimedSmsRetry } = await import("@/lib/sms-queue");
    await resetUsage(0);
    const row = await createRetryRow({ phone: "not-a-phone" });

    const [a, b] = await Promise.all([executeClaimedSmsRetry(row.id), executeClaimedSmsRetry(row.id)]);

    expect([a.claimed, b.claimed].filter(Boolean)).toHaveLength(1);
    const after = await prisma.smsMessage.findUnique({ where: { id: row.id } });
    expect(after.retryCount).toBe(1);
    expect(after.status).toBe("FAILED"); // finalized by its single owner
    expect(await usage()).toBe(0); // nothing reserved (denied pre-reservation) and nothing released
  });

  it("ONE-TIME RELEASE: a failed attempt releases exactly once; replays release nothing and never erase another successful attempt's unit", async () => {
    const { finalizeSmsAttemptFailure, finalizeSmsAttemptSuccess } = await import("@/lib/sms-attempt-finalization");
    const { reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    await resetUsage(0);

    const msg1 = await createRetryRow({ status: "QUEUED", nextRetryAt: null });
    const msg2 = await createRetryRow({ status: "QUEUED", nextRetryAt: null });

    const r1 = await reserveSmsAllowance(orgId);
    const r2 = await reserveSmsAllowance(orgId);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(await usage()).toBe(2);

    // First message succeeds — its unit is permanently consumed.
    await expect(finalizeSmsAttemptSuccess({ kind: "initial", messageId: msg1.id }, { providerMessageId: "SMok" })).resolves.toBe(true);

    // Second message fails and releases exactly once.
    const msg2Claim = { kind: "initial", messageId: msg2.id } as const;
    await expect(finalizeSmsAttemptFailure(msg2Claim, r2, "boom")).resolves.toBe(true);
    expect(await usage()).toBe(1);

    // Replaying msg2's failure/finalization path releases NOTHING more —
    // msg1's successful unit survives.
    await expect(finalizeSmsAttemptFailure(msg2Claim, r2, "boom replay")).resolves.toBe(false);
    expect(await usage()).toBe(1);
  });

  it("CONCURRENT FINALIZERS: many duplicate failure finalizers for one message — exactly one wins and exactly one unit is released", async () => {
    const { finalizeSmsAttemptFailure } = await import("@/lib/sms-attempt-finalization");
    const { reserveSmsAllowance } = await import("@/lib/sms-entitlement");
    await resetUsage(0);

    const msg = await createRetryRow({ status: "QUEUED", nextRetryAt: null });
    const reservation = await reserveSmsAllowance(orgId);
    expect(await usage()).toBe(1);

    const claim = { kind: "initial", messageId: msg.id } as const;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => finalizeSmsAttemptFailure(claim, reservation, "concurrent boom"))
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await usage()).toBe(0); // released exactly once, floor intact
  });
});
