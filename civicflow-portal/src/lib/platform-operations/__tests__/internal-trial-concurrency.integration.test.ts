import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Real-database atomicity and concurrency tests for
 * grantInternalOrganizationTrial() / terminateInternalOrganizationTrialEarly()
 * — deliberately NOT using a mocked Prisma client for the organization/audit
 * writes, mirroring admin-seat-concurrency.integration.test.ts's structure
 * and skip convention. The mocked unit tests (internal-trial.test.ts) can
 * only prove the code CALLS things in the right order; they can't prove two
 * genuinely simultaneous requests against the same organization actually
 * serialize under real Postgres, or that a real transaction actually rolls
 * back a real row when an insert inside it throws.
 *
 * `createAuditEvent` is the one thing test-mocked here (not `@/lib/prisma`)
 * — its real implementation is still used by default (delegated through),
 * so every "success" assertion below is a genuine end-to-end real-database
 * write. `auditShouldFail` flips it to throw on demand, which is the only
 * practical way to force the specific "audit insert fails after the
 * organization update already ran" failure mode this suite exists to prove
 * gets rolled back — AuditEvent has no column-level constraint in this
 * schema that a normal test input could violate to trigger the same thing
 * organically.
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

let auditShouldFail = false;

vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return {
    ...actual,
    createAuditEvent: async (input: Parameters<typeof actual.createAuditEvent>[0]) => {
      if (auditShouldFail) {
        throw new Error("Simulated audit insert failure (test-forced, for rollback proof)");
      }
      return actual.createAuditEvent(input);
    },
  };
});

describe.skipIf(!RUN_INTEGRATION)("internal trial grant/termination — real atomicity and concurrency", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  const orgIds: string[] = [];
  // AuditEvent.actorId carries a real foreign key to User — a fabricated
  // string id fails the insert (correctly), so a real User row is required
  // here, same as admin-seat-concurrency.integration.test.ts's filler/racer users.
  let testActorId: string;

  async function createTestOrg(label: string) {
    const org = await prisma.organization.create({
      data: {
        slug: `internal-trial-atomicity-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: `Internal Trial Atomicity Test Org (${label})`,
        primaryVertical: "PTA",
        status: "active",
        billingExempt: false,
        trialEndsAt: null,
      },
    });
    orgIds.push(org.id);
    return org.id;
  }

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const actor = await prisma.user.create({
      data: { email: `internal-trial-atomicity-actor-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" },
    });
    testActorId = actor.id;
  });

  afterAll(async () => {
    for (const id of orgIds) {
      await prisma?.auditEvent.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma?.organization.delete({ where: { id } }).catch(() => {});
    }
    if (testActorId) {
      await prisma?.user.delete({ where: { id: testActorId } }).catch(() => {});
    }
    await prisma?.$disconnect();
  });

  afterEach(() => {
    auditShouldFail = false;
  });

  describe("grant — atomicity", () => {
    it("organization update and grant audit event commit together on success", async () => {
      const orgId = await createTestOrg("grant-success");
      const { grantInternalOrganizationTrial } = await import("../internal-trial");

      await grantInternalOrganizationTrial({
        organizationId: orgId,
        actorUserId: testActorId,
        actorEmail: "atomicity-test@example.test",
        actorRole: "SUPER_ADMIN",
        reason: "Atomicity test: update and audit commit together",
      });

      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org.trialEndsAt).not.toBeNull();

      const events = await prisma.auditEvent.findMany({
        where: { organizationId: orgId, action: "platform.organization.internal_trial_granted" },
      });
      expect(events).toHaveLength(1);
    });

    it("a forced audit-insert failure leaves trialEndsAt=null — the organization update is rolled back, not just the audit", async () => {
      const orgId = await createTestOrg("grant-forced-failure");
      const { grantInternalOrganizationTrial } = await import("../internal-trial");

      auditShouldFail = true;
      await expect(
        grantInternalOrganizationTrial({
          organizationId: orgId,
          actorUserId: testActorId,
          actorEmail: "atomicity-test@example.test",
          actorRole: "SUPER_ADMIN",
          reason: "Atomicity test: forced audit failure must roll back the grant",
        })
      ).rejects.toThrow("Simulated audit insert failure");

      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org.trialEndsAt).toBeNull();
      expect(org.billingExempt).toBe(false);

      const events = await prisma.auditEvent.findMany({ where: { organizationId: orgId } });
      expect(events).toHaveLength(0);
    });

    it("a successful retry after the fully-rolled-back failure works normally", async () => {
      const orgId = await createTestOrg("grant-retry-after-rollback");
      const { grantInternalOrganizationTrial } = await import("../internal-trial");

      auditShouldFail = true;
      await expect(
        grantInternalOrganizationTrial({
          organizationId: orgId,
          actorUserId: testActorId,
          actorEmail: "atomicity-test@example.test",
          actorRole: "SUPER_ADMIN",
          reason: "First attempt, forced to fail",
        })
      ).rejects.toThrow();

      const afterFailure = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(afterFailure.trialEndsAt).toBeNull(); // still eligible — the failure left no partial state

      auditShouldFail = false;
      const result = await grantInternalOrganizationTrial({
        organizationId: orgId,
        actorUserId: testActorId,
        actorEmail: "atomicity-test@example.test",
        actorRole: "SUPER_ADMIN",
        reason: "Retry after the rolled-back failure",
      });
      expect(result.accessActive).toBe(true);

      const afterRetry = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(afterRetry.trialEndsAt).not.toBeNull();

      const events = await prisma.auditEvent.findMany({
        where: { organizationId: orgId, action: "platform.organization.internal_trial_granted" },
      });
      expect(events).toHaveLength(1); // exactly one — the failed attempt left zero rows
    });

    it("a repeated request after success is rejected, does not extend the trial, and does not create a second success audit", async () => {
      const orgId = await createTestOrg("grant-repeat-after-success");
      const { grantInternalOrganizationTrial } = await import("../internal-trial");

      const first = await grantInternalOrganizationTrial({
        organizationId: orgId,
        actorUserId: testActorId,
        actorEmail: "atomicity-test@example.test",
        actorRole: "SUPER_ADMIN",
        reason: "First, successful grant",
      });

      await expect(
        grantInternalOrganizationTrial({
          organizationId: orgId,
          actorUserId: testActorId,
          actorEmail: "atomicity-test@example.test",
          actorRole: "SUPER_ADMIN",
          reason: "Repeated request after success",
        })
      ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_ALREADY_ACTIVE" });

      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org.trialEndsAt?.toISOString()).toBe(first.trialExpiresAt); // unchanged — not extended

      const events = await prisma.auditEvent.findMany({
        where: { organizationId: orgId, action: "platform.organization.internal_trial_granted" },
      });
      expect(events).toHaveLength(1); // still exactly one
    });
  });

  describe("grant — concurrency", () => {
    it("exactly one of two simultaneous grants succeeds; the losing request creates no audit event", async () => {
      const orgId = await createTestOrg("grant-concurrency");
      const { grantInternalOrganizationTrial } = await import("../internal-trial");

      const attempt = (label: string) =>
        grantInternalOrganizationTrial({
          organizationId: orgId,
          actorUserId: testActorId,
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
        // Two valid rejection codes exist depending on real scheduling: if
        // the loser's updateMany runs after the winner's commit, its WHERE
        // clause (trialEndsAt: null) simply matches zero rows ->
        // CONCURRENT_CONFLICT. If the loser's own initial read happens
        // after the winner's transaction has already committed, the loser
        // sees a non-null trialEndsAt on that very read and rejects earlier,
        // via the ordinary ALREADY_ACTIVE eligibility check. Both are
        // correct, safe outcomes of the same race — what actually matters
        // (asserted below) is that exactly one grant and one audit event
        // exist, never two.
        expect(["INTERNAL_TRIAL_CONCURRENT_CONFLICT", "INTERNAL_TRIAL_ALREADY_ACTIVE"]).toContain(
          (failed[0].reason as { code?: string }).code
        );
      }

      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org.trialEndsAt).not.toBeNull();
      const expectedMs = 30 * 24 * 60 * 60 * 1000;
      const actualMs = org.trialEndsAt.getTime() - Date.now();
      expect(actualMs).toBeGreaterThan(expectedMs - 60_000);
      expect(actualMs).toBeLessThan(expectedMs + 60_000);

      const events = await prisma.auditEvent.findMany({
        where: { organizationId: orgId, action: "platform.organization.internal_trial_granted" },
      });
      expect(events).toHaveLength(1); // the loser's transaction rolled back before ever reaching the audit insert
    });
  });

  describe("termination — atomicity", () => {
    it("termination update and termination audit event commit together", async () => {
      const orgId = await createTestOrg("terminate-success");
      const { grantInternalOrganizationTrial, terminateInternalOrganizationTrialEarly } = await import("../internal-trial");

      await grantInternalOrganizationTrial({
        organizationId: orgId,
        actorUserId: testActorId,
        actorEmail: "atomicity-test@example.test",
        actorRole: "SUPER_ADMIN",
        reason: "Grant before termination test",
      });

      const result = await terminateInternalOrganizationTrialEarly({
        organizationId: orgId,
        actorUserId: testActorId,
        actorEmail: "atomicity-test@example.test",
        actorRole: "SUPER_ADMIN",
        reason: "Pilot phase complete, ending early",
      });

      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org.trialEndsAt?.toISOString()).toBe(result.terminatedAt);
      expect(org.trialEndsAt).not.toBeNull(); // never nulled back out

      const grantEvents = await prisma.auditEvent.findMany({
        where: { organizationId: orgId, action: "platform.organization.internal_trial_granted" },
      });
      expect(grantEvents).toHaveLength(1); // the original grant audit is preserved, untouched

      const terminateEvents = await prisma.auditEvent.findMany({
        where: { organizationId: orgId, action: "platform.organization.internal_trial_terminated" },
      });
      expect(terminateEvents).toHaveLength(1);
    });

    it("a forced audit-insert failure leaves the prior trial end unchanged", async () => {
      const orgId = await createTestOrg("terminate-forced-failure");
      const { grantInternalOrganizationTrial, terminateInternalOrganizationTrialEarly } = await import("../internal-trial");

      const grant = await grantInternalOrganizationTrial({
        organizationId: orgId,
        actorUserId: testActorId,
        actorEmail: "atomicity-test@example.test",
        actorRole: "SUPER_ADMIN",
        reason: "Grant before forced-failure termination test",
      });

      auditShouldFail = true;
      await expect(
        terminateInternalOrganizationTrialEarly({
          organizationId: orgId,
          actorUserId: testActorId,
          actorEmail: "atomicity-test@example.test",
          actorRole: "SUPER_ADMIN",
          reason: "Forced to fail",
        })
      ).rejects.toThrow("Simulated audit insert failure");

      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org.trialEndsAt?.toISOString()).toBe(grant.trialExpiresAt); // exactly the original grant's end time, untouched

      const terminateEvents = await prisma.auditEvent.findMany({
        where: { organizationId: orgId, action: "platform.organization.internal_trial_terminated" },
      });
      expect(terminateEvents).toHaveLength(0);
    });

    it("concurrent termination attempts: one succeeds, one gets a defined conflict, no duplicate termination audit events", async () => {
      const orgId = await createTestOrg("terminate-concurrency");
      const { grantInternalOrganizationTrial, terminateInternalOrganizationTrialEarly } = await import("../internal-trial");

      await grantInternalOrganizationTrial({
        organizationId: orgId,
        actorUserId: testActorId,
        actorEmail: "atomicity-test@example.test",
        actorRole: "SUPER_ADMIN",
        reason: "Grant before concurrent termination test",
      });

      const attempt = (label: string) =>
        terminateInternalOrganizationTrialEarly({
          organizationId: orgId,
          actorUserId: testActorId,
          actorEmail: "concurrency-test@example.test",
          actorRole: "SUPER_ADMIN",
          reason: `Concurrent termination attempt ${label}`,
        });

      const [r1, r2] = await Promise.allSettled([attempt("A"), attempt("B")]);
      const succeeded = [r1, r2].filter((r) => r.status === "fulfilled");
      const failed = [r1, r2].filter((r) => r.status === "rejected");
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      if (failed[0].status === "rejected") {
        // Same real-scheduling ambiguity as the grant-concurrency test above:
        // the loser's updateMany may find zero matching rows
        // (CONCURRENT_CONFLICT), or its own initial read may already
        // observe the winner's committed change and reject earlier via the
        // ordinary "no active trial" check (NOT_ACTIVE). Both are correct;
        // what matters is exactly one termination and one audit event.
        expect(["INTERNAL_TRIAL_CONCURRENT_CONFLICT", "INTERNAL_TRIAL_NOT_ACTIVE"]).toContain(
          (failed[0].reason as { code?: string }).code
        );
      }

      const terminateEvents = await prisma.auditEvent.findMany({
        where: { organizationId: orgId, action: "platform.organization.internal_trial_terminated" },
      });
      expect(terminateEvents).toHaveLength(1);
    });

    it("a terminated trial never becomes eligible for another grant", async () => {
      const orgId = await createTestOrg("terminate-no-restacking");
      const { grantInternalOrganizationTrial, terminateInternalOrganizationTrialEarly } = await import("../internal-trial");

      await grantInternalOrganizationTrial({
        organizationId: orgId,
        actorUserId: testActorId,
        actorEmail: "atomicity-test@example.test",
        actorRole: "SUPER_ADMIN",
        reason: "Grant before no-restacking test",
      });
      await terminateInternalOrganizationTrialEarly({
        organizationId: orgId,
        actorUserId: testActorId,
        actorEmail: "atomicity-test@example.test",
        actorRole: "SUPER_ADMIN",
        reason: "Ending early, before testing re-grant is blocked",
      });

      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      expect(org.trialEndsAt).not.toBeNull(); // never null again

      await expect(
        grantInternalOrganizationTrial({
          organizationId: orgId,
          actorUserId: testActorId,
          actorEmail: "atomicity-test@example.test",
          actorRole: "SUPER_ADMIN",
          reason: "Attempted re-grant after early termination",
        })
      ).rejects.toMatchObject({ code: "INTERNAL_TRIAL_ALREADY_USED" });
    });
  });
});
