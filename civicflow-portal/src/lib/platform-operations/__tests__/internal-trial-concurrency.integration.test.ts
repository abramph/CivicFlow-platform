import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database concurrency test for grantInternalOrganizationTrial's
 * anti-stacking guarantee — deliberately NOT using a mocked Prisma client,
 * mirroring admin-seat-concurrency.integration.test.ts's structure and skip
 * convention. The mocked unit tests (internal-trial.test.ts) can only prove
 * the code calls a conditional updateMany with the right WHERE clause; they
 * can't prove two genuinely simultaneous grant attempts against the same
 * organization actually serialize under real Postgres.
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run with
 * DATABASE_URL pointed at a disposable/local Postgres BEFORE starting vitest:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   INTERNAL_TRIAL_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/platform-operations/__tests__/internal-trial-concurrency.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.INTERNAL_TRIAL_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("grantInternalOrganizationTrial — real concurrency", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: {
        slug: `internal-trial-concurrency-${Date.now()}`,
        name: "Internal Trial Concurrency Test Org",
        primaryVertical: "PTA",
        status: "active",
        billingExempt: false,
        trialEndsAt: null,
      },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    await prisma?.auditEvent.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("exactly one of two simultaneous grant attempts for the same never-trialed organization succeeds", async () => {
    const { grantInternalOrganizationTrial } = await import("../internal-trial");

    const attempt = (label: string) =>
      grantInternalOrganizationTrial({
        organizationId: orgId,
        actorUserId: "concurrency-test-actor",
        actorEmail: "concurrency-test@example.test",
        actorRole: "SUPER_ADMIN",
        reason: `Concurrency test attempt ${label}`,
      });

    const [r1, r2] = await Promise.allSettled([attempt("A"), attempt("B")]);

    const succeeded = [r1, r2].filter((r) => r.status === "fulfilled");
    const failed = [r1, r2].filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    if (failed[0].status === "rejected") {
      expect((failed[0].reason as { code?: string }).code).toBe("INTERNAL_TRIAL_CONCURRENT_CONFLICT");
    }

    // The critical assertion: real Postgres state has exactly one trial
    // grant's worth of effect, never a stacked/extended one, even though
    // both racers observed "no prior trial" if the conditional update
    // didn't actually serialize.
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.trialEndsAt).not.toBeNull();
    const expectedMs = 30 * 24 * 60 * 60 * 1000;
    const actualMs = org.trialEndsAt.getTime() - Date.now();
    // Wide tolerance (test runtime variance), but nowhere near double.
    expect(actualMs).toBeGreaterThan(expectedMs - 60_000);
    expect(actualMs).toBeLessThan(expectedMs + 60_000);

    const auditEvents = await prisma.auditEvent.findMany({
      where: { organizationId: orgId, action: "platform.organization.internal_trial_granted" },
    });
    expect(auditEvents).toHaveLength(1);
  });

  it("a second grant attempt after a successful one is rejected — no extension, no re-stacking", async () => {
    const { grantInternalOrganizationTrial } = await import("../internal-trial");
    await expect(
      grantInternalOrganizationTrial({
        organizationId: orgId,
        actorUserId: "concurrency-test-actor",
        actorEmail: "concurrency-test@example.test",
        actorRole: "SUPER_ADMIN",
        reason: "Attempted second grant after the trial above",
      })
    ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_ALREADY_ACTIVE" });
  });
});
