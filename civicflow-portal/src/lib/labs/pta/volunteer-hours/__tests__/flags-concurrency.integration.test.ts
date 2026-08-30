import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Real-database atomicity and concurrency tests for
 * updatePtaVolunteerHoursFlags() — mirrors
 * internal-trial-concurrency.integration.test.ts's structure and skip
 * convention exactly (same program, same underlying bug class: a profile/
 * organization write and its audit event committing as two independent
 * statements instead of one transaction).
 *
 * `createAuditEvent` is the one thing test-mocked here (not `@/lib/prisma`)
 * — its real implementation is still used by default (delegated through), so
 * every "success" assertion below is a genuine end-to-end real-database
 * write. `auditShouldFail` flips it to throw on demand, standing in for the
 * exact production failure this correction fixes (an invalid placeholder
 * actorUserId caused AuditEvent's real FK constraint to reject the insert —
 * reproduced directly, not simulated, in the "invalid actor" tests below).
 * `@/lib/env`'s two gate functions are also mocked, matching
 * pta-profile-route.test.ts's existing convention, so platform/allowlist
 * state is deterministic regardless of what's in the environment running
 * the test.
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run with
 * DATABASE_URL pointed at a disposable/local Postgres BEFORE starting vitest:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   PTA_VOLUNTEER_FLAGS_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/labs/pta/volunteer-hours/__tests__/flags-concurrency.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.PTA_VOLUNTEER_FLAGS_RUN_DB_INTEGRATION_TEST === "1";

let auditShouldFail = false;
let platformEnabled = true;
let orgAllowed = true;

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

vi.mock("@/lib/env", () => ({
  isPtaVolunteerHoursPlatformEnabled: () => platformEnabled,
  isPtaVolunteerHoursOrgAllowed: () => orgAllowed,
}));

describe.skipIf(!RUN_INTEGRATION)("updatePtaVolunteerHoursFlags — real atomicity and concurrency", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  const orgIds: string[] = [];
  // AuditEvent.actorId carries a real foreign key to User — a fabricated
  // string id fails the insert (correctly). This is the exact production
  // failure mode: the disable write committed, but its audit insert threw on
  // AuditEvent_actorId_fkey because the calling script's actorUserId wasn't
  // a real User row.
  let testActorId: string;
  const INVALID_ACTOR_ID = "not-a-real-user-id-placeholder";

  async function createTestOrgWithProfile(label: string, flags: Partial<Record<string, boolean>> = {}) {
    const org = await prisma.organization.create({
      data: {
        slug: `pta-flags-atomicity-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: `PTA Flags Atomicity Test Org (${label})`,
        primaryVertical: "PTA",
        status: "active",
        billingExempt: false,
      },
    });
    orgIds.push(org.id);
    await prisma.ptaProfile.create({
      data: {
        organizationId: org.id,
        schoolOrPtaName: `Test PTA (${label})`,
        currentSchoolYear: "2026-2027",
        ptaVolunteerRequirementsEnabled: false,
        ptaVolunteerBuyoutEnabled: false,
        ptaVolunteerAssessmentsEnabled: false,
        ptaVolunteerReportsEnabled: false,
        ptaVolunteerNotificationsEnabled: false,
        ptaVolunteerNativeMobileEnabled: false,
        ...flags,
      },
    });
    return org.id;
  }

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const actor = await prisma.user.create({
      data: { email: `pta-flags-atomicity-actor-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" },
    });
    testActorId = actor.id;
  });

  afterAll(async () => {
    for (const id of orgIds) {
      await prisma?.auditEvent.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma?.ptaProfile.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma?.organization.delete({ where: { id } }).catch(() => {});
    }
    if (testActorId) {
      await prisma?.user.delete({ where: { id: testActorId } }).catch(() => {});
    }
    await prisma?.$disconnect();
  });

  beforeEach(() => {
    platformEnabled = true;
    orgAllowed = true;
  });

  afterEach(() => {
    auditShouldFail = false;
  });

  describe("atomicity", () => {
    it("a valid flag change commits the profile update and its audit event together", async () => {
      const orgId = await createTestOrgWithProfile("valid-commit");
      const { updatePtaVolunteerHoursFlags } = await import("../flags");

      const result = await updatePtaVolunteerHoursFlags({
        organizationId: orgId,
        actorUserId: testActorId,
        actorEmail: "atomicity-test@example.test",
        changes: { ptaVolunteerReportsEnabled: true },
      });
      expect(result.changed).toEqual({ ptaVolunteerReportsEnabled: { before: false, after: true } });

      const profile = await prisma.ptaProfile.findUniqueOrThrow({ where: { organizationId: orgId } });
      expect(profile.ptaVolunteerReportsEnabled).toBe(true);
      expect(profile.ptaVolunteerRequirementsEnabled).toBe(false); // unrelated flag untouched

      const events = await prisma.auditEvent.findMany({
        where: { organizationId: orgId, action: "pta.volunteer_hours.flags_changed" },
      });
      expect(events).toHaveLength(1);
      expect(events[0].after).toEqual({ ptaVolunteerReportsEnabled: { before: false, after: true } });
    });

    it("a forced audit-insert failure rolls back the profile update — this is the exact production bug, now fixed", async () => {
      const orgId = await createTestOrgWithProfile("forced-audit-failure");
      const { updatePtaVolunteerHoursFlags } = await import("../flags");

      auditShouldFail = true;
      await expect(
        updatePtaVolunteerHoursFlags({
          organizationId: orgId,
          actorUserId: testActorId,
          actorEmail: "atomicity-test@example.test",
          changes: { ptaVolunteerReportsEnabled: true },
        })
      ).rejects.toThrow("Simulated audit insert failure");

      const profile = await prisma.ptaProfile.findUniqueOrThrow({ where: { organizationId: orgId } });
      expect(profile.ptaVolunteerReportsEnabled).toBe(false); // NOT true — the update was rolled back with the audit

      const events = await prisma.auditEvent.findMany({ where: { organizationId: orgId } });
      expect(events).toHaveLength(0);
    });

    it("an invalid/nonexistent actor causes zero profile change and zero audit — real FK violation, real rollback", async () => {
      const orgId = await createTestOrgWithProfile("invalid-actor");
      const { updatePtaVolunteerHoursFlags } = await import("../flags");

      await expect(
        updatePtaVolunteerHoursFlags({
          organizationId: orgId,
          actorUserId: INVALID_ACTOR_ID,
          actorEmail: "invalid-actor-test@example.test",
          changes: { ptaVolunteerReportsEnabled: true },
        })
      ).rejects.toThrow();

      const profile = await prisma.ptaProfile.findUniqueOrThrow({ where: { organizationId: orgId } });
      expect(profile.ptaVolunteerReportsEnabled).toBe(false); // unchanged — this is the fix

      const events = await prisma.auditEvent.findMany({ where: { organizationId: orgId } });
      expect(events).toHaveLength(0);
    });

    it("a no-op request (requested value already matches current) creates no audit event and performs no write", async () => {
      const orgId = await createTestOrgWithProfile("no-op", { ptaVolunteerReportsEnabled: true });
      const { updatePtaVolunteerHoursFlags } = await import("../flags");

      const before = await prisma.ptaProfile.findUniqueOrThrow({ where: { organizationId: orgId } });

      const result = await updatePtaVolunteerHoursFlags({
        organizationId: orgId,
        actorUserId: testActorId,
        actorEmail: "no-op-test@example.test",
        changes: { ptaVolunteerReportsEnabled: true }, // already true
      });
      expect(result.changed).toEqual({});

      const after = await prisma.ptaProfile.findUniqueOrThrow({ where: { organizationId: orgId } });
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

      const events = await prisma.auditEvent.findMany({ where: { organizationId: orgId } });
      expect(events).toHaveLength(0);
    });

    it("only the fields that actually changed appear in the audit metadata — an untouched flag is never listed", async () => {
      const orgId = await createTestOrgWithProfile("partial-metadata", { ptaVolunteerReportsEnabled: true });
      const { updatePtaVolunteerHoursFlags } = await import("../flags");

      await updatePtaVolunteerHoursFlags({
        organizationId: orgId,
        actorUserId: testActorId,
        actorEmail: "partial-metadata-test@example.test",
        // ptaVolunteerReportsEnabled requested as its CURRENT value (true) —
        // should not appear in the delta even though it's in the request.
        changes: { ptaVolunteerReportsEnabled: true, ptaVolunteerBuyoutEnabled: true },
      });

      const events = await prisma.auditEvent.findMany({ where: { organizationId: orgId } });
      expect(events).toHaveLength(1);
      expect(events[0].after).toEqual({ ptaVolunteerBuyoutEnabled: { before: false, after: true } });
      expect(events[0].after).not.toHaveProperty("ptaVolunteerReportsEnabled");
    });

    it("platform-off attempts fail without any database mutation, even with a valid actor", async () => {
      const orgId = await createTestOrgWithProfile("platform-off");
      const { updatePtaVolunteerHoursFlags } = await import("../flags");
      platformEnabled = false;

      await expect(
        updatePtaVolunteerHoursFlags({
          organizationId: orgId,
          actorUserId: testActorId,
          actorEmail: "platform-off-test@example.test",
          changes: { ptaVolunteerReportsEnabled: true },
        })
      ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_HOURS_PLATFORM_DISABLED" });

      const profile = await prisma.ptaProfile.findUniqueOrThrow({ where: { organizationId: orgId } });
      expect(profile.ptaVolunteerReportsEnabled).toBe(false);
      const events = await prisma.auditEvent.findMany({ where: { organizationId: orgId } });
      expect(events).toHaveLength(0);
    });

    it("non-allowlisted attempts fail without any database mutation, even with a valid actor and platform on", async () => {
      const orgId = await createTestOrgWithProfile("not-allowlisted");
      const { updatePtaVolunteerHoursFlags } = await import("../flags");
      orgAllowed = false;

      await expect(
        updatePtaVolunteerHoursFlags({
          organizationId: orgId,
          actorUserId: testActorId,
          actorEmail: "not-allowlisted-test@example.test",
          changes: { ptaVolunteerReportsEnabled: true },
        })
      ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED" });

      const profile = await prisma.ptaProfile.findUniqueOrThrow({ where: { organizationId: orgId } });
      expect(profile.ptaVolunteerReportsEnabled).toBe(false);
      const events = await prisma.auditEvent.findMany({ where: { organizationId: orgId } });
      expect(events).toHaveLength(0);
    });
  });

  describe("concurrency", () => {
    it("two simultaneous requests changing the SAME flag: real scheduling decides one of two safe outcomes, but never two audit events for the same change and never a wrong final value", async () => {
      const orgId = await createTestOrgWithProfile("same-flag-race");
      const { updatePtaVolunteerHoursFlags } = await import("../flags");

      const attempt = (label: string) =>
        updatePtaVolunteerHoursFlags({
          organizationId: orgId,
          actorUserId: testActorId,
          actorEmail: `race-${label}@example.test`,
          changes: { ptaVolunteerReportsEnabled: true },
        });

      const [r1, r2] = await Promise.allSettled([attempt("A"), attempt("B")]);
      const succeeded = [r1, r2].filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof attempt>>> => r.status === "fulfilled");
      const failed = [r1, r2].filter((r) => r.status === "rejected");
      // Two legitimate outcomes for this real race, both proven safe by the
      // assertions below (matching internal-trial-concurrency.integration.test's
      // documented ambiguity):
      // (a) the loser's conditional updateMany runs after the winner's
      //     commit -> its WHERE predicate (ptaVolunteerReportsEnabled: false)
      //     matches zero rows -> PTA_VOLUNTEER_HOURS_FLAGS_CONCURRENT_CONFLICT.
      // (b) the loser's own initial read happens to already observe the
      //     winner's committed value -> its delta computes to a genuine
      //     no-op (changed: {}) -> resolves successfully with no write and
      //     no audit event, which is correct, not a bug, for an idempotent
      //     "set to true" request that's already true.
      // What must NEVER happen, and is what these assertions actually prove:
      // two audit events for the same transition, or a final value other
      // than true.
      expect(succeeded.length + failed.length).toBe(2);
      if (failed.length > 0) {
        expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({ code: "PTA_VOLUNTEER_HOURS_FLAGS_CONCURRENT_CONFLICT" });
      }
      // At most one of the two fulfilled results represents a real change —
      // the other, if also fulfilled, must be the empty-delta no-op case.
      const realChanges = succeeded.filter((r) => Object.keys(r.value.changed).length > 0);
      expect(realChanges).toHaveLength(1);

      const profile = await prisma.ptaProfile.findUniqueOrThrow({ where: { organizationId: orgId } });
      expect(profile.ptaVolunteerReportsEnabled).toBe(true);

      const events = await prisma.auditEvent.findMany({
        where: { organizationId: orgId, action: "pta.volunteer_hours.flags_changed" },
      });
      expect(events).toHaveLength(1); // never two — whichever path the loser took, it never wrote a second audit event
    });

    it("two simultaneous requests changing DIFFERENT flags: both succeed, neither audit event is misleading, final state has both changes", async () => {
      const orgId = await createTestOrgWithProfile("disjoint-flags-race");
      const { updatePtaVolunteerHoursFlags } = await import("../flags");

      const [r1, r2] = await Promise.allSettled([
        updatePtaVolunteerHoursFlags({
          organizationId: orgId,
          actorUserId: testActorId,
          actorEmail: "disjoint-a@example.test",
          changes: { ptaVolunteerReportsEnabled: true },
        }),
        updatePtaVolunteerHoursFlags({
          organizationId: orgId,
          actorUserId: testActorId,
          actorEmail: "disjoint-b@example.test",
          changes: { ptaVolunteerBuyoutEnabled: true },
        }),
      ]);

      expect(r1.status).toBe("fulfilled");
      expect(r2.status).toBe("fulfilled");

      const profile = await prisma.ptaProfile.findUniqueOrThrow({ where: { organizationId: orgId } });
      expect(profile.ptaVolunteerReportsEnabled).toBe(true);
      expect(profile.ptaVolunteerBuyoutEnabled).toBe(true);

      const events = await prisma.auditEvent.findMany({
        where: { organizationId: orgId, action: "pta.volunteer_hours.flags_changed" },
      });
      expect(events).toHaveLength(2);
      const merged = (events as { after: object }[]).reduce((acc: object, e) => ({ ...acc, ...e.after }), {});
      expect(merged).toEqual({
        ptaVolunteerReportsEnabled: { before: false, after: true },
        ptaVolunteerBuyoutEnabled: { before: false, after: true },
      });
    });
  });
});
