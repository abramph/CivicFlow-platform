import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Real-database concurrency/atomicity suite for the super-admin SMS
 * enrollment endpoint (PUT /api/admin/sms/organizations/[id]) and the
 * applySmsAdminOrgSettings() writer it delegates to. A mocked-Prisma unit
 * test (admin-sms-organizations-route.test.ts) can prove the route validates
 * and delegates, but ONLY a real Postgres can prove the enable/disable
 * transition is genuinely atomic — that two simultaneous requests can't both
 * activate, double-reset the billing period, or emit two addon_activated
 * events. That is what this file exists to prove.
 *
 * requireSuperAdmin is the one thing mocked (authorization is out of scope
 * here); @/lib/prisma, @/lib/audit and applySmsAdminOrgSettings all run for
 * real against DATABASE_URL, so every assertion below is a genuine
 * end-to-end database write.
 *
 * Runs in CI inside the isolated-Postgres job (.github/workflows/
 * pr-validation.yml) against that job's throwaway container. Locally:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   HOA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/__tests__/admin-sms-organizations-concurrency.integration.test.ts
 * Never point this at a shared or production database; it creates and deletes
 * real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.HOA_RUN_DB_INTEGRATION_TEST === "1";

// Set in beforeAll; read lazily inside the mock (same pattern as
// internal-trial-concurrency.integration.test.ts's auditShouldFail).
let actorId = "";

vi.mock("@/lib/auth-guards", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth-guards")>("@/lib/auth-guards");
  return {
    ...actual,
    requireSuperAdmin: async () => ({ session: { userId: actorId, userEmail: "sms-admin-concurrency@example.test" } }),
  };
});

describe.skipIf(!RUN_INTEGRATION)("PUT /api/admin/sms/organizations/[id] — real-database atomic enrollment", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  const orgIds: string[] = [];

  async function createExemptOrg(label: string): Promise<string> {
    const org = await prisma.organization.create({
      data: {
        slug: `sms-admin-concurrency-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: `SMS Admin Concurrency Org (${label})`,
        primaryVertical: "COMMUNITY",
        billingExempt: true,
      },
    });
    orgIds.push(org.id);
    return org.id;
  }

  async function callPut(orgId: string, body: unknown) {
    const { PUT } = await import("@/app/api/admin/sms/organizations/[id]/route");
    const req = new Request(`https://x/api/admin/sms/organizations/${orgId}`, { method: "PUT", body: JSON.stringify(body) });
    return PUT(req, { params: Promise.resolve({ id: orgId }) });
  }

  async function countAudits(orgId: string, action: string): Promise<number> {
    return prisma.auditEvent.count({ where: { organizationId: orgId, action } });
  }

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    const actor = await prisma.user.create({
      data: { email: `sms-admin-concurrency-actor-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" },
    });
    actorId = actor.id;
  });

  afterAll(async () => {
    for (const id of orgIds) {
      await prisma?.auditEvent.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma?.organizationSmsSettings.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma?.organization.delete({ where: { id } }).catch(() => {});
    }
    if (actorId) await prisma?.user.delete({ where: { id: actorId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("two simultaneous activations → exactly one addon_activated, one fresh period, usage 0, and NO Stripe item", async () => {
    const orgId = await createExemptOrg("activate");

    const [r1, r2] = await Promise.all([
      callPut(orgId, { smsAddOnActive: true, smsMonthlyLimit: 1000, reason: "Concurrent enroll A" }),
      callPut(orgId, { smsAddOnActive: true, smsMonthlyLimit: 1000, reason: "Concurrent enroll B" }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const row = await prisma.organizationSmsSettings.findUniqueOrThrow({ where: { organizationId: orgId } });
    expect(row.smsAddOnActive).toBe(true);
    expect(row.smsUsedThisPeriod).toBe(0);
    expect(row.smsBillingPeriodStart).not.toBeNull();
    expect(row.smsBillingPeriodEnd).not.toBeNull();
    const spanDays = (row.smsBillingPeriodEnd.getTime() - row.smsBillingPeriodStart.getTime()) / 86_400_000;
    expect(spanDays).toBeGreaterThanOrEqual(28);
    expect(spanDays).toBeLessThanOrEqual(31);
    // No Stripe operation ever occurs for billing-exempt enrollment.
    expect(row.stripeSmsSubscriptionItemId).toBeNull();

    // Exactly one activation transition — the loser recorded a plain settings
    // update, never a second addon_activated.
    expect(await countAudits(orgId, "sms_admin.addon_activated")).toBe(1);
  });

  it("idempotent re-sends after activation never reset the live period or usage, and add no activation audit", async () => {
    const orgId = await createExemptOrg("idempotent");
    await callPut(orgId, { smsAddOnActive: true, smsMonthlyLimit: 1000, reason: "Initial enroll" });

    // Real usage accrues in the live period.
    await prisma.organizationSmsSettings.update({ where: { organizationId: orgId }, data: { smsUsedThisPeriod: 7 } });
    const before = await prisma.organizationSmsSettings.findUniqueOrThrow({ where: { organizationId: orgId } });

    const [a, b] = await Promise.all([
      callPut(orgId, { smsAddOnActive: true }),
      callPut(orgId, { smsAddOnActive: true }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const after = await prisma.organizationSmsSettings.findUniqueOrThrow({ where: { organizationId: orgId } });
    expect(after.smsUsedThisPeriod).toBe(7); // NOT reset
    expect(after.smsBillingPeriodStart.getTime()).toBe(before.smsBillingPeriodStart.getTime()); // period unchanged
    expect(await countAudits(orgId, "sms_admin.addon_activated")).toBe(1); // still exactly one
  });

  it("two simultaneous deactivations → exactly one addon_deactivated, usage and period history preserved", async () => {
    const orgId = await createExemptOrg("deactivate");
    await callPut(orgId, { smsAddOnActive: true, smsMonthlyLimit: 1000, reason: "Enroll before deactivation" });
    await prisma.organizationSmsSettings.update({ where: { organizationId: orgId }, data: { smsUsedThisPeriod: 42 } });
    const before = await prisma.organizationSmsSettings.findUniqueOrThrow({ where: { organizationId: orgId } });

    const [r1, r2] = await Promise.all([
      callPut(orgId, { smsAddOnActive: false, reason: "Wrap-up A" }),
      callPut(orgId, { smsAddOnActive: false, reason: "Wrap-up B" }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const row = await prisma.organizationSmsSettings.findUniqueOrThrow({ where: { organizationId: orgId } });
    expect(row.smsAddOnActive).toBe(false);
    expect(row.smsUsedThisPeriod).toBe(42); // preserved, not erased
    expect(row.smsBillingPeriodStart.getTime()).toBe(before.smsBillingPeriodStart.getTime()); // history preserved
    expect(await countAudits(orgId, "sms_admin.addon_deactivated")).toBe(1); // exactly one
  });
});
