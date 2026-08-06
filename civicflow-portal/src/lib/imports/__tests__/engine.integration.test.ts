import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database test for the Resumable Import Program's engine —
 * deliberately NOT using a mocked Prisma client, mirroring the established
 * convention in this codebase (e.g. src/lib/hoa/__tests__/*-concurrency.integration.test.ts,
 * src/lib/__tests__/whatsapp-conversation-sender.integration.test.ts). The
 * mocked unit tests (engine.test.ts) can only prove the code calls the right
 * Prisma methods with the right arguments; they can't prove the atomic claim
 * actually makes two genuinely simultaneous executeBatch() calls race-safe
 * against real Postgres, or that checkMemberLimit()'s real COUNT query
 * produces the exact pause-then-resume-then-complete row counts the program
 * promises.
 *
 * analyzeBatch() itself is intentionally NOT exercised here — it requires a
 * real DigitalOcean Spaces object to read, which this test deliberately
 * avoids depending on. Rows are seeded directly via Prisma instead, which is
 * sufficient to exercise executeBatch()/resumeBatch()'s real behavior (the
 * part that most needs real-DB proof) without a live Spaces dependency.
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run with:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   HOA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/imports/__tests__/engine.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.HOA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("Resumable Import Program engine — real Postgres", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgAId: string;
  let orgBId: string;
  let actorUserId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const stamp = Date.now();
    const orgA = await prisma.organization.create({
      data: { slug: `import-engine-a-${stamp}`, name: "Import Engine Test Org A", primaryVertical: "COMMUNITY", plan: "free" },
    });
    const orgB = await prisma.organization.create({
      data: { slug: `import-engine-b-${stamp}`, name: "Import Engine Test Org B", primaryVertical: "COMMUNITY", plan: "free" },
    });
    orgAId = orgA.id;
    orgBId = orgB.id;

    const actor = await prisma.user.create({ data: { email: `import-engine-actor-${stamp}@example.test`, passwordHash: "test-hash-not-real" } });
    actorUserId = actor.id;
  });

  afterAll(async () => {
    await prisma?.auditEvent.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } }).catch(() => {});
    await prisma?.importRow.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } }).catch(() => {});
    await prisma?.importBatch.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } }).catch(() => {});
    await prisma?.orgMember.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } }).catch(() => {});
    await prisma?.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } }).catch(() => {});
    await prisma?.user.delete({ where: { id: actorUserId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  async function makeBatch(organizationId: string, overrides: Record<string, unknown> = {}) {
    return prisma.importBatch.create({
      data: {
        organizationId,
        importKind: "COMMUNITY_MEMBERS",
        fileName: "members.csv",
        fileHash: `hash-${Math.random().toString(36).slice(2)}`,
        fileSizeBytes: 100,
        columnMapping: { "First Name": "firstName", "Last Name": "lastName" },
        status: "IMPORTING",
        ...overrides,
      },
    });
  }

  function normalizedRow(firstName: string) {
    return { firstName, lastName: "Test", email: null, emailError: null, phone: null, addressLine1: null, city: null, state: null, zipCode: null, joinDate: null };
  }

  it("the (batchId, rowNumber) unique constraint prevents a duplicate row from ever being inserted twice", async () => {
    const batch = await makeBatch(orgAId);
    await prisma.importRow.create({
      data: {
        batchId: batch.id,
        organizationId: orgAId,
        rowNumber: 2,
        rawData: {},
        normalizedData: normalizedRow("Jane"),
        fingerprint: "fp-1",
        status: "NEW",
      },
    });

    await expect(
      prisma.importRow.create({
        data: {
          batchId: batch.id,
          organizationId: orgAId,
          rowNumber: 2,
          rawData: {},
          normalizedData: normalizedRow("Jane"),
          fingerprint: "fp-1",
          status: "NEW",
        },
      })
    ).rejects.toThrow();

    const rows = await prisma.importRow.findMany({ where: { batchId: batch.id } });
    expect(rows).toHaveLength(1);
  });

  it("exactly one of two simultaneous executeBatch() calls on the same batch actually processes rows", async () => {
    const { executeBatch } = await import("../engine");
    const batch = await makeBatch(orgAId);
    await prisma.importRow.create({
      data: {
        batchId: batch.id,
        organizationId: orgAId,
        rowNumber: 2,
        rawData: {},
        normalizedData: normalizedRow("Concurrent"),
        fingerprint: "fp-concurrent",
        status: "NEW",
        decision: "IMPORT_NEW",
      },
    });

    const before = await prisma.orgMember.count({ where: { organizationId: orgAId, firstName: "Concurrent" } });
    await Promise.allSettled([executeBatch(batch.id, orgAId), executeBatch(batch.id, orgAId)]);
    const after = await prisma.orgMember.count({ where: { organizationId: orgAId, firstName: "Concurrent" } });

    expect(after - before).toBe(1);
  });

  it("pauses at the plan limit, then resumes after capacity opens up, importing every eligible row exactly once", async () => {
    const { executeBatch, resumeBatch } = await import("../engine");

    // "free" plan's member limit is 50 — top up to exactly 48 (accounting
    // for any members earlier tests in this file already created in this
    // org), leaving precisely 2 slots.
    const currentCount = await prisma.orgMember.count({ where: { organizationId: orgAId } });
    const toSeed = Math.max(0, 48 - currentCount);
    await prisma.orgMember.createMany({
      data: Array.from({ length: toSeed }, (_, i) => ({ organizationId: orgAId, firstName: `Existing${i}`, lastName: "Member" })),
    });

    const batch = await makeBatch(orgAId);
    await prisma.importRow.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        batchId: batch.id,
        organizationId: orgAId,
        rowNumber: i + 2,
        rawData: {},
        normalizedData: normalizedRow(`PlanLimitRow${i}`),
        fingerprint: `fp-planlimit-${i}`,
        status: "NEW" as const,
        decision: "IMPORT_NEW" as const,
      })),
    });

    await executeBatch(batch.id, orgAId);

    const pausedBatch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(pausedBatch.status).toBe("PAUSED_PLAN_LIMIT");
    expect(pausedBatch.importedCount).toBe(2);
    expect(pausedBatch.blockedPlanLimitCount).toBe(3);

    const importedRows = await prisma.importRow.count({ where: { batchId: batch.id, status: "IMPORTED" } });
    const blockedRows = await prisma.importRow.count({ where: { batchId: batch.id, status: "BLOCKED_PLAN_LIMIT" } });
    expect(importedRows).toBe(2);
    expect(blockedRows).toBe(3);

    // Free up capacity (simulates a plan upgrade / member removal) and resume.
    const toFree = await prisma.orgMember.findMany({ where: { organizationId: orgAId, firstName: { startsWith: "Existing" } }, take: 10 });
    await prisma.orgMember.deleteMany({ where: { id: { in: toFree.map((m: { id: string }) => m.id) } } });

    await resumeBatch(batch.id, orgAId, actorUserId);

    const completedBatch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(completedBatch.status).toBe("COMPLETED");
    expect(completedBatch.importedCount).toBe(5);

    const finalImportedRows = await prisma.importRow.count({ where: { batchId: batch.id, status: "IMPORTED" } });
    expect(finalImportedRows).toBe(5);

    const finalMemberCount = await prisma.orgMember.count({ where: { organizationId: orgAId, firstName: { startsWith: "PlanLimitRow" } } });
    expect(finalMemberCount).toBe(5);
  });

  it("resumeBatch rechecks capacity fresh and refuses to resume when the plan is still at its limit", async () => {
    const { executeBatch, resumeBatch } = await import("../engine");

    await prisma.orgMember.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({ organizationId: orgBId, firstName: `Full${i}`, lastName: "Member" })),
    });

    const batch = await makeBatch(orgBId);
    await prisma.importRow.create({
      data: {
        batchId: batch.id,
        organizationId: orgBId,
        rowNumber: 2,
        rawData: {},
        normalizedData: normalizedRow("StillBlocked"),
        fingerprint: "fp-still-blocked",
        status: "NEW",
        decision: "IMPORT_NEW",
      },
    });

    await executeBatch(batch.id, orgBId);
    const paused = await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(paused.status).toBe("PAUSED_PLAN_LIMIT");

    await expect(resumeBatch(batch.id, orgBId, actorUserId)).rejects.toThrow();
    const stillPaused = await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(stillPaused.status).toBe("PAUSED_PLAN_LIMIT");
  });

  it("findExistingBatchByHash is scoped to the organization — a hash match in a different org is never revealed", async () => {
    const { findExistingBatchByHash } = await import("../file-identity");
    const sharedHash = `shared-hash-${Date.now()}`;
    await makeBatch(orgAId, { fileHash: sharedHash, status: "COMPLETED" });

    const matchInOwnOrg = await findExistingBatchByHash(orgAId, "COMMUNITY_MEMBERS", sharedHash);
    const matchInOtherOrg = await findExistingBatchByHash(orgBId, "COMMUNITY_MEMBERS", sharedHash);

    expect(matchInOwnOrg).not.toBeNull();
    expect(matchInOtherOrg).toBeNull();
  });

  it("transitionImportBatch throws for a batchId that belongs to a different organization (tenant isolation)", async () => {
    const { transitionImportBatch } = await import("../batch-state-machine");
    const { ImportError } = await import("../errors");
    const batch = await makeBatch(orgAId, { status: "UPLOADED" });

    await expect(transitionImportBatch({ batchId: batch.id, organizationId: orgBId, to: "ANALYZING" })).rejects.toBeInstanceOf(ImportError);
  });
});
