import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database concurrency test for terminateMember/reinstateMember's
 * compare-and-swap -- deliberately NOT using a mocked Prisma client,
 * mirroring src/lib/hoa/__tests__/architectural-requests-concurrency.integration.test.ts's
 * structure and skip convention. The mocked unit tests (member-lifecycle.test.ts)
 * can only prove the code calls updateMany() with the right WHERE clause; they
 * can't prove the compare-and-swap actually makes two genuinely simultaneous
 * terminations of the same member race-safe against real Postgres.
 *
 * Skipped by default (no live DB in a normal `vitest run`) -- run with
 * DATABASE_URL pointed at a disposable/local Postgres BEFORE starting vitest:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   HOA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/__tests__/member-lifecycle-concurrency.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.HOA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("member-lifecycle — real concurrency", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;
  let actorUserId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: { slug: `member-lifecycle-concurrency-${Date.now()}`, name: "Member Lifecycle Concurrency Test Org", primaryVertical: "COMMUNITY" },
    });
    orgId = org.id;

    const actor = await prisma.user.create({ data: { email: `member-lifecycle-actor-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    actorUserId = actor.id;
  });

  afterAll(async () => {
    await prisma?.memberTimelineEvent.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.auditEvent.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.orgMember.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma?.user.delete({ where: { id: actorUserId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("exactly one of two simultaneous terminations of the same member wins", async () => {
    const { terminateMember } = await import("../member-lifecycle");

    const memberRow = await prisma.orgMember.create({
      data: { organizationId: orgId, firstName: "Race", lastName: "Condition", membershipStatus: "active" },
    });

    const [r1, r2] = await Promise.allSettled([
      terminateMember({ organizationId: orgId, memberId: memberRow.id, actorUserId, reasonCode: "RESIGNED_VOLUNTARY", effectiveDate: "2026-08-01" }),
      terminateMember({ organizationId: orgId, memberId: memberRow.id, actorUserId, reasonCode: "NONPAYMENT_OF_DUES", effectiveDate: "2026-08-01" }),
    ]);

    const succeeded = [r1, r2].filter((r) => r.status === "fulfilled");
    const failed = [r1, r2].filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    if (failed[0].status === "rejected") {
      expect((failed[0].reason as { code?: string }).code).toBe("MEMBER_ALREADY_TERMINATED");
    }

    const final = await prisma.orgMember.findUniqueOrThrow({ where: { id: memberRow.id } });
    expect(final.membershipStatus).toBe("terminated");

    const timelineRows = await prisma.memberTimelineEvent.findMany({ where: { memberId: memberRow.id, eventType: "TERMINATED" } });
    expect(timelineRows).toHaveLength(1);
  });

  it("a genuine double-reinstate yields exactly one success and one real MEMBER_NOT_TERMINATED", async () => {
    const { terminateMember, reinstateMember } = await import("../member-lifecycle");

    const memberRow = await prisma.orgMember.create({
      data: { organizationId: orgId, firstName: "Double", lastName: "Reinstate", membershipStatus: "active" },
    });
    await terminateMember({ organizationId: orgId, memberId: memberRow.id, actorUserId, reasonCode: "MOVED_RELOCATED", effectiveDate: "2026-08-01" });

    const [r1, r2] = await Promise.allSettled([
      reinstateMember({ organizationId: orgId, memberId: memberRow.id, actorUserId, reason: "Reinstate attempt 1", effectiveDate: "2026-08-02" }),
      reinstateMember({ organizationId: orgId, memberId: memberRow.id, actorUserId, reason: "Reinstate attempt 2", effectiveDate: "2026-08-02" }),
    ]);

    const succeeded = [r1, r2].filter((r) => r.status === "fulfilled");
    const failed = [r1, r2].filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    if (failed[0].status === "rejected") {
      expect((failed[0].reason as { code?: string }).code).toBe("MEMBER_NOT_TERMINATED");
    }

    const final = await prisma.orgMember.findUniqueOrThrow({ where: { id: memberRow.id } });
    expect(final.membershipStatus).toBe("active");
  });

  it("blocks terminating an org's sole active owner and does not mutate anything", async () => {
    const { terminateMember } = await import("../member-lifecycle");

    const ownerUser = await prisma.user.create({ data: { email: `member-lifecycle-owner-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    const membership = await prisma.organizationMembership.create({
      data: { organizationId: orgId, userId: ownerUser.id, role: "ORG_OWNER", status: "active" },
    });
    const ownerMember = await prisma.orgMember.create({
      data: { organizationId: orgId, userId: ownerUser.id, firstName: "Sole", lastName: "Owner", membershipStatus: "active" },
    });

    await expect(
      terminateMember({ organizationId: orgId, memberId: ownerMember.id, actorUserId, reasonCode: "RESIGNED_VOLUNTARY", effectiveDate: "2026-08-01" })
    ).rejects.toMatchObject({ code: "LAST_OWNER_CANNOT_BE_TERMINATED" });

    const unchangedMember = await prisma.orgMember.findUniqueOrThrow({ where: { id: ownerMember.id } });
    expect(unchangedMember.membershipStatus).toBe("active");
    const unchangedMembership = await prisma.organizationMembership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(unchangedMembership.status).toBe("active");

    await prisma.orgMember.delete({ where: { id: ownerMember.id } });
    await prisma.organizationMembership.delete({ where: { id: membership.id } });
    await prisma.user.delete({ where: { id: ownerUser.id } });
  });
});
