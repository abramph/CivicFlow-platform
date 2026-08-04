import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database concurrency test for the architectural-request state
 * machine's compare-and-swap transitions -- deliberately NOT using a
 * mocked Prisma client, mirroring
 * property-resident-concurrency.integration.test.ts and
 * violations-reminder-concurrency.integration.test.ts's structure and
 * skip convention. Mocked unit tests (architectural-requests.test.ts) can
 * only prove the code calls updateMany() with the right WHERE clause;
 * they can't prove the unique-status-match condition actually makes two
 * genuinely simultaneous transitions on the same request race-safe
 * against real Postgres.
 *
 * Skipped by default (no live DB in a normal `vitest run`) -- run with
 * DATABASE_URL pointed at a disposable/local Postgres BEFORE starting
 * vitest, e.g.:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   HOA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/hoa/__tests__/architectural-requests-concurrency.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows. Real notification delivery is a no-op in this
 * environment (ENABLE_EMAIL_SEND=0 in .env.development.local).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.HOA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("HOA ArchitecturalRequest — real concurrency", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;
  let propertyId: string;
  let memberId: string;
  let officerUserId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: { slug: `hoa-arc-concurrency-${Date.now()}`, name: "HOA Architectural Request Concurrency Test Org", primaryVertical: "HOA" },
    });
    orgId = org.id;

    const officer = await prisma.user.create({ data: { email: `hoa-arc-officer-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    officerUserId = officer.id;

    const property = await prisma.property.create({ data: { organizationId: orgId, addressLine1: "1 Architectural Race Ct", propertyType: "SINGLE_FAMILY" } });
    propertyId = property.id;

    const member = await prisma.orgMember.create({ data: { organizationId: orgId, firstName: "Architectural", lastName: "Submitter" } });
    memberId = member.id;
  });

  afterAll(async () => {
    await prisma?.architecturalRequestStatusHistory.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.architecturalRequestComment.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.architecturalRequest.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.property.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.orgMember.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma?.user.delete({ where: { id: officerUserId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("exactly one of two simultaneous divergent decisions wins, with no legitimate sequential path for both to succeed", async () => {
    const { createArchitecturalRequestDraft, submitArchitecturalRequest, transitionArchitecturalRequestStatus } = await import("../architectural-requests");

    const draft = await createArchitecturalRequestDraft({
      organizationId: orgId,
      propertyId,
      submittedByOrgMemberId: memberId,
      category: "FENCE",
      title: "Race condition fence",
      projectDescription: "Fixture request for concurrency testing",
    });
    await submitArchitecturalRequest({ organizationId: orgId, requestId: draft.id, submittedByOrgMemberId: memberId });
    await transitionArchitecturalRequestStatus({ organizationId: orgId, requestId: draft.id, toStatus: "IN_REVIEW", actorUserId: officerUserId });

    // APPROVED and DENIED are both valid *from* IN_REVIEW, but neither is
    // reachable from the other (both terminal) -- so there is no
    // legitimate sequential ordering under which both could succeed,
    // matching the exact test-design fix applied to the HOA Violations
    // concurrency test after an earlier false-positive-prone version.
    const [r1, r2] = await Promise.allSettled([
      transitionArchitecturalRequestStatus({ organizationId: orgId, requestId: draft.id, toStatus: "APPROVED", actorUserId: officerUserId, decisionSummary: "Approved." }),
      transitionArchitecturalRequestStatus({ organizationId: orgId, requestId: draft.id, toStatus: "DENIED", actorUserId: officerUserId, decisionSummary: "Denied." }),
    ]);

    const succeeded = [r1, r2].filter((r) => r.status === "fulfilled");
    const failed = [r1, r2].filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);

    const failedCode = failed[0]?.status === "rejected" ? (failed[0].reason as { code?: string }).code : null;
    expect(["HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE", "HOA_ARCHITECTURAL_REQUEST_INVALID_TRANSITION"]).toContain(failedCode);

    const final = await prisma.architecturalRequest.findUniqueOrThrow({ where: { id: draft.id } });
    expect(["APPROVED", "DENIED"]).toContain(final.status);

    const historyRows = await prisma.architecturalRequestStatusHistory.findMany({ where: { requestId: draft.id, fromStatus: "IN_REVIEW" } });
    expect(historyRows).toHaveLength(1);
    expect(historyRows[0].toStatus).toBe(final.status);
  });

  it("a genuine double-submit (two simultaneous DRAFT->SUBMITTED calls) yields exactly one success and one real HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE", async () => {
    const { createArchitecturalRequestDraft, submitArchitecturalRequest } = await import("../architectural-requests");

    const draft = await createArchitecturalRequestDraft({
      organizationId: orgId,
      propertyId,
      submittedByOrgMemberId: memberId,
      category: "SHED",
      title: "Double-submit shed",
      projectDescription: "Fixture request for double-submit testing",
    });

    const [r1, r2] = await Promise.allSettled([
      submitArchitecturalRequest({ organizationId: orgId, requestId: draft.id, submittedByOrgMemberId: memberId }),
      submitArchitecturalRequest({ organizationId: orgId, requestId: draft.id, submittedByOrgMemberId: memberId }),
    ]);

    const succeeded = [r1, r2].filter((r) => r.status === "fulfilled");
    const failed = [r1, r2].filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    if (failed[0].status === "rejected") {
      expect((failed[0].reason as { code?: string }).code).toBe("HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE");
    }
  });
});
