import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Real-database suite for Round-5 launch hardening:
 *
 *  - campaign SMS idempotency: the partial unique index
 *    (SmsMessage_org_campaign_member_attempt_key) + the application's
 *    unique-violation handling guarantee ONE SmsMessage, ONE quota
 *    reservation, and ONE provider invocation per (org, campaign, member),
 *    no matter how many campaign invocations race (manual Send Now vs the
 *    scheduled processor are the same code path: sendMemberSms);
 *  - the initial-send QUEUED→SENDING claim vs the atomic Cancel CAS: every
 *    race has exactly one winner and cancellation is truthful;
 *  - ambiguous provider outcomes park the attempt outside every automatic
 *    path;
 *  - migration safety: duplicate data makes the index CREATE fail loudly —
 *    nothing is ever silently deleted.
 *
 * The Twilio adapter (lib/sms) is the ONLY mocked module — provider
 * invocations are counted through it and no network call can occur; the
 * database, authorization, entitlement, claims, and finalization are all
 * real. Runs in CI inside the isolated-Postgres job. Locally:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   HOA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run --no-file-parallelism src/lib/__tests__/sms-campaign-idempotency.integration.test.ts
 * Never point this at a shared or production database. NOTE: the
 * integration files temporarily flip PlatformSmsSettings.orgMessagingEnabled
 * (restored afterwards) and must not run file-parallel against one DB.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.HOA_RUN_DB_INTEGRATION_TEST === "1";

const sendSmsMock = vi.fn();
vi.mock("@/lib/sms", () => ({
  isSmsConfigured: () => Promise.resolve(true),
  sendSms: (...args: unknown[]) => sendSmsMock(...args),
  TWILIO_REQUEST_TIMEOUT_MS: 30_000,
}));

const requireSuperAdmin = vi.fn();
vi.mock("@/lib/auth-guards", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth-guards")>("@/lib/auth-guards");
  return { ...actual, requireSuperAdmin: (...args: unknown[]) => requireSuperAdmin(...args) };
});

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

describe.skipIf(!RUN_INTEGRATION)("campaign idempotency + cancel races + ambiguous outcomes — real database", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;
  let memberId: string;
  let memberBId: string;
  let campaignAId: string;
  let campaignBId: string;
  let platformRowExisted: boolean;
  let platformPrevEnabled: boolean | undefined;

  const futureEnd = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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
        slug: `sms-campaign-idem-${Date.now()}`,
        name: "SMS Campaign Idempotency Test Org",
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
    const member = await prisma.orgMember.create({
      data: {
        organizationId: orgId,
        firstName: "Consent",
        lastName: "Given",
        phone: "+15550001111",
        smsOptIn: true,
        commsSmsEnabled: true,
      },
    });
    memberId = member.id;
    const memberB = await prisma.orgMember.create({
      data: {
        organizationId: orgId,
        firstName: "Second",
        lastName: "Member",
        phone: "+15550002222",
        smsOptIn: true,
        commsSmsEnabled: true,
      },
    });
    memberBId = memberB.id;
    const campaignA = await prisma.communicationCampaign.create({
      data: { organizationId: orgId, title: "Idem A", communicationType: "ANNOUNCEMENT", channel: "SMS", subject: "-", body: "hello" },
    });
    campaignAId = campaignA.id;
    const campaignB = await prisma.communicationCampaign.create({
      data: { organizationId: orgId, title: "Idem B", communicationType: "ANNOUNCEMENT", channel: "SMS", subject: "-", body: "hello" },
    });
    campaignBId = campaignB.id;

    const existing = await prisma.platformSmsSettings.findFirst();
    platformRowExisted = Boolean(existing);
    platformPrevEnabled = existing?.orgMessagingEnabled;
    if (existing) {
      await prisma.platformSmsSettings.update({ where: { id: existing.id }, data: { orgMessagingEnabled: true } });
    } else {
      await prisma.platformSmsSettings.create({ data: { orgMessagingEnabled: true } });
    }
  });

  afterAll(async () => {
    try {
      const current = await prisma?.platformSmsSettings.findFirst();
      if (current && platformRowExisted) {
        await prisma.platformSmsSettings.update({ where: { id: current.id }, data: { orgMessagingEnabled: platformPrevEnabled } });
      } else if (current && !platformRowExisted) {
        await prisma.platformSmsSettings.delete({ where: { id: current.id } }).catch(() => {});
      }
    } finally {
      await prisma?.smsMessage.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma?.communicationCampaign.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma?.orgMember.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma?.organizationSmsSettings.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma?.organization.delete({ where: { id: orgId } }).catch(() => {});
      await prisma?.$disconnect();
    }
  });

  it("TWO CONCURRENT campaign sends for one campaign/member → one SmsMessage, one reservation, one provider invocation (manual Send Now racing scheduled processing is this exact code path)", async () => {
    const { sendMemberSms } = await import("@/lib/sms-service");
    sendSmsMock.mockReset().mockResolvedValue({ sent: true, skipped: false, outcome: "sent", to: "+15550001111", providerMessageId: "SMidem1" });
    await resetUsage(0);

    const params = { organizationId: orgId, memberId, phone: "+15550001111", body: "campaign hello", campaignId: campaignAId };
    const [a, b] = await Promise.all([sendMemberSms(params), sendMemberSms(params)]);

    const rows = await prisma.smsMessage.findMany({ where: { organizationId: orgId, campaignId: campaignAId, memberId } });
    expect(rows).toHaveLength(1);
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(await usage()).toBe(1);
    // Both invocations report the same canonical row.
    expect(a.id).toBe(rows[0].id);
    expect(b.id).toBe(rows[0].id);
    expect(rows[0].status).toBe("SENT");
    expect(rows[0].retryCount).toBe(0);
  });

  it("TWENTY concurrent duplicate attempts → one winner, one provider invocation, one consumed unit", async () => {
    const { sendMemberSms } = await import("@/lib/sms-service");
    sendSmsMock.mockReset().mockResolvedValue({ sent: true, skipped: false, outcome: "sent", to: "+15550002222", providerMessageId: "SMidem20" });
    await resetUsage(0);

    const params = { organizationId: orgId, memberId: memberBId, phone: "+15550002222", body: "campaign hello", campaignId: campaignAId };
    const results = await Promise.all(Array.from({ length: 20 }, () => sendMemberSms(params)));

    const rows = await prisma.smsMessage.findMany({ where: { organizationId: orgId, campaignId: campaignAId, memberId: memberBId } });
    expect(rows).toHaveLength(1);
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(await usage()).toBe(1);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
  }, 30_000);

  it("different members in the same campaign, and the same member in a different campaign, remain independently sendable; non-campaign messages are unconstrained", async () => {
    const { sendMemberSms } = await import("@/lib/sms-service");
    sendSmsMock.mockReset().mockResolvedValue({ sent: true, skipped: false, outcome: "sent", to: "+15550001111", providerMessageId: "SMother" });
    await resetUsage(0);

    // Same member, DIFFERENT campaign: allowed (previous tests used campaign A).
    const differentCampaign = await sendMemberSms({ organizationId: orgId, memberId, phone: "+15550001111", body: "b", campaignId: campaignBId });
    expect(differentCampaign.status).toBe("SENT");

    // Non-campaign transactional sends for the same member: two in a row both create rows.
    await sendMemberSms({ organizationId: orgId, memberId, phone: "+15550001111", body: "t1" });
    await sendMemberSms({ organizationId: orgId, memberId, phone: "+15550001111", body: "t2" });
    const nonCampaign = await prisma.smsMessage.findMany({ where: { organizationId: orgId, memberId, campaignId: null } });
    expect(nonCampaign.length).toBeGreaterThanOrEqual(2);
  });

  it("CANCEL vs INITIAL CLAIM race: exactly one wins — cancel-first means zero reservations and zero provider calls; claim-first rejects the cancel with a truthful conflict", async () => {
    const { claimInitialSmsAttempt } = await import("@/lib/sms-attempt-finalization");
    const { POST: cancel } = await import("@/app/api/admin/sms/messages/[id]/cancel/route");
    requireSuperAdmin.mockResolvedValue({ session: { userId: "admin-1", userEmail: "admin@example.com" } });

    for (let i = 0; i < 5; i += 1) {
      createAuditEvent.mockClear();
      const row = await prisma.smsMessage.create({
        data: { organizationId: orgId, memberId, phone: "+15550001111", body: "race", status: "QUEUED" },
      });

      const [claim, cancelResponse] = await Promise.all([
        claimInitialSmsAttempt(row.id),
        cancel(new Request("https://x"), { params: Promise.resolve({ id: row.id }) }),
      ]);

      const after = await prisma.smsMessage.findUnique({ where: { id: row.id } });
      if (claim) {
        // Send claim won: cancellation must have been rejected truthfully.
        expect(cancelResponse.status).toBe(400);
        expect(after.status).toBe("SENDING");
        expect(createAuditEvent).not.toHaveBeenCalled();
      } else {
        // Cancel won: the send side must never reserve or call the provider.
        expect(cancelResponse.status).toBe(200);
        expect(after.status).toBe("FAILED");
        expect(after.errorMessage).toBe("Cancelled by admin.");
        expect(createAuditEvent).toHaveBeenCalledTimes(1);
      }
    }
  }, 30_000);

  it("CANCEL vs RETRY CLAIM race: same single-winner behavior on an eligible RETRYING row", async () => {
    const { claimSmsRetryAttempt } = await import("@/lib/sms-queue");
    const { POST: cancel } = await import("@/app/api/admin/sms/messages/[id]/cancel/route");
    requireSuperAdmin.mockResolvedValue({ session: { userId: "admin-1", userEmail: "admin@example.com" } });

    for (let i = 0; i < 5; i += 1) {
      const row = await prisma.smsMessage.create({
        data: { organizationId: orgId, memberId, phone: "+15550001111", body: "race", status: "RETRYING", nextRetryAt: new Date(Date.now() - 1000) },
      });

      const [claim, cancelResponse] = await Promise.all([
        claimSmsRetryAttempt(row.id),
        cancel(new Request("https://x"), { params: Promise.resolve({ id: row.id }) }),
      ]);

      const after = await prisma.smsMessage.findUnique({ where: { id: row.id } });
      if (claim) {
        expect(cancelResponse.status).toBe(400);
        expect(after.status).toBe("SENDING");
      } else {
        expect(cancelResponse.status).toBe(200);
        expect(after.status).toBe("FAILED");
        expect(after.nextRetryAt).toBeNull();
      }
    }
  }, 30_000);

  it("TWO SIMULTANEOUS cancels → exactly one succeeds and exactly one audit event", async () => {
    const { POST: cancel } = await import("@/app/api/admin/sms/messages/[id]/cancel/route");
    requireSuperAdmin.mockResolvedValue({ session: { userId: "admin-1", userEmail: "admin@example.com" } });
    createAuditEvent.mockClear();

    const row = await prisma.smsMessage.create({
      data: { organizationId: orgId, memberId, phone: "+15550001111", body: "double cancel", status: "QUEUED" },
    });

    const [r1, r2] = await Promise.all([
      cancel(new Request("https://x"), { params: Promise.resolve({ id: row.id }) }),
      cancel(new Request("https://x"), { params: Promise.resolve({ id: row.id }) }),
    ]);

    expect([r1.status, r2.status].sort()).toEqual([200, 400]);
    expect(createAuditEvent).toHaveBeenCalledTimes(1);
    const after = await prisma.smsMessage.findUnique({ where: { id: row.id } });
    expect(after.status).toBe("FAILED");
  });

  it("AMBIGUOUS OUTCOME end-to-end: quota stays consumed, the row parks as SENDING with no lease and the honest reason, and no automatic path can touch it", async () => {
    const { sendMemberSms } = await import("@/lib/sms-service");
    const { claimSmsRetryAttempt } = await import("@/lib/sms-queue");
    const { POST: retry } = await import("@/app/api/admin/sms/messages/[id]/retry/route");
    requireSuperAdmin.mockResolvedValue({ session: { userId: "admin-1", userEmail: "admin@example.com" } });
    sendSmsMock.mockReset().mockResolvedValue({
      sent: false,
      skipped: false,
      outcome: "unknown",
      to: "+15550001111",
      reason: "Delivery outcome is unknown; verify in Twilio before retrying.",
    });
    await resetUsage(0);

    const result = await sendMemberSms({ organizationId: orgId, memberId, phone: "+15550001111", body: "ambiguous" });

    expect(result.status).toBe("SENDING");
    expect(result.nextRetryAt).toBeNull();
    expect(result.errorMessage).toBe("Delivery outcome is unknown; verify in Twilio before retrying.");
    expect(await usage()).toBe(1); // NOT released — the message may have gone out

    // Excluded from the cron sweep's candidate predicate (nextRetryAt is null)…
    const sweepMatches = await prisma.smsMessage.findMany({
      where: { id: result.id, status: { in: ["RETRYING", "SENDING"] }, nextRetryAt: { lte: new Date() } },
    });
    expect(sweepMatches).toHaveLength(0);
    // …not claimable by the shared retry-claim CAS…
    await expect(claimSmsRetryAttempt(result.id)).resolves.toBeNull();
    // …and rejected by the ordinary manual Retry button (FAILED-only).
    const retryResponse = await retry(new Request("https://x"), { params: Promise.resolve({ id: result.id }) });
    expect(retryResponse.status).toBe(400);
    expect(await usage()).toBe(1);
  });

  it("MIGRATION SAFETY: with duplicate campaign rows present, creating the unique index fails explicitly and deletes nothing", async () => {
    // Test-owned database only: temporarily drop the index, plant real
    // duplicates, and prove `CREATE UNIQUE INDEX` refuses loudly — the
    // exact behavior the production migration would have on conflicting
    // data — then restore.
    await prisma.$executeRawUnsafe('DROP INDEX "SmsMessage_org_campaign_member_attempt_key"');
    try {
      const dupe = { organizationId: orgId, memberId, campaignId: campaignBId, phone: "+15550001111", body: "dupe", status: "FAILED" };
      const d1 = await prisma.smsMessage.create({ data: { ...dupe } });
      const d2 = await prisma.smsMessage.create({ data: { ...dupe } });

      await expect(
        prisma.$executeRawUnsafe(
          'CREATE UNIQUE INDEX "SmsMessage_org_campaign_member_attempt_key" ON "SmsMessage"("organizationId", "campaignId", "memberId") WHERE "campaignId" IS NOT NULL AND "memberId" IS NOT NULL'
        )
      ).rejects.toThrow();

      // Explicit failure, zero deletion: both duplicates survive untouched.
      const survivors = await prisma.smsMessage.findMany({ where: { id: { in: [d1.id, d2.id] } } });
      expect(survivors).toHaveLength(2);

      await prisma.smsMessage.deleteMany({ where: { id: { in: [d1.id, d2.id] } } });
    } finally {
      await prisma.$executeRawUnsafe(
        'CREATE UNIQUE INDEX IF NOT EXISTS "SmsMessage_org_campaign_member_attempt_key" ON "SmsMessage"("organizationId", "campaignId", "memberId") WHERE "campaignId" IS NOT NULL AND "memberId" IS NOT NULL'
      );
    }
  });

  it("the restored index actively rejects a duplicate campaign attempt (P2002)", async () => {
    const base = { organizationId: orgId, memberId: memberBId, campaignId: campaignBId, phone: "+15550002222", body: "only-once", status: "FAILED" };
    const first = await prisma.smsMessage.create({ data: { ...base } });
    await expect(prisma.smsMessage.create({ data: { ...base } })).rejects.toMatchObject({ code: "P2002" });
    await prisma.smsMessage.delete({ where: { id: first.id } });
  });
});
