import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * fix/report-export-queue-hardening — real, database-backed proof of the
 * atomic-claim guarantee. Deliberately does NOT mock @/lib/prisma: this
 * test needs a genuine Postgres instance to prove genuine row-locking
 * behavior, which a mocked client can't demonstrate.
 *
 * SKIPPED BY DEFAULT — opt in explicitly with:
 *   REPORT_EXPORT_QUEUE_TEST_DATABASE_URL=postgresql://postgres@localhost:5433/civicflow_dev?schema=public
 * so `npx vitest run` never silently tries to reach a real database (this
 * repo's ambient .env/.env.local point at PRODUCTION — this test must never
 * run against that by accident). Verified against the isolated local
 * civicflow_dev database (already used elsewhere in this project for safe,
 * non-production testing), never against production.
 */
const TEST_DB_URL = process.env.REPORT_EXPORT_QUEUE_TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)("report-export-queue — real Postgres concurrency proof", () => {
  const prisma = new PrismaClient(TEST_DB_URL ? { datasourceUrl: TEST_DB_URL } : undefined);
  let orgId: string;
  const createdExportIds: string[] = [];

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: {
        name: "__test_report_export_queue_hardening__",
        slug: `test-req-hardening-${Date.now()}`,
      },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    if (createdExportIds.length > 0) {
      await prisma.reportExport.deleteMany({ where: { id: { in: createdExportIds } } });
    }
    if (orgId) {
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  async function createQueuedExport() {
    const row = await prisma.reportExport.create({
      data: { organizationId: orgId, reportType: "PTA_VOLUNTEER_FAMILY_SUMMARY", outputFormat: "xlsx", status: "QUEUED" },
    });
    createdExportIds.push(row.id);
    return row.id;
  }

  it("two concurrent claim attempts on the SAME export: exactly one succeeds", async () => {
    const { attemptClaimReportExport } = await import("../report-export-queue");
    const id = await createQueuedExport();

    const [a, b] = await Promise.all([attemptClaimReportExport(id), attemptClaimReportExport(id)]);
    const winners = [a, b].filter((r) => r.claimed);
    expect(winners).toHaveLength(1);

    const row = await prisma.reportExport.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("PROCESSING");
    expect(row.attemptCount).toBe(1); // only the winner's increment applied, not both
  });

  it("ten concurrent claim attempts on the SAME export: exactly one succeeds, attemptCount increments exactly once", async () => {
    const { attemptClaimReportExport } = await import("../report-export-queue");
    const id = await createQueuedExport();

    const results = await Promise.all(Array.from({ length: 10 }, () => attemptClaimReportExport(id)));
    const winners = results.filter((r) => r.claimed);
    expect(winners).toHaveLength(1);

    const row = await prisma.reportExport.findUniqueOrThrow({ where: { id } });
    expect(row.attemptCount).toBe(1);
  });

  it("two concurrent batch claims across MULTIPLE queued exports: each export is claimed by exactly one caller, no export claimed twice", async () => {
    const { claimReportExportBatch } = await import("../report-export-queue");
    const ids = await Promise.all(Array.from({ length: 6 }, () => createQueuedExport()));

    const [batchA, batchB] = await Promise.all([claimReportExportBatch(10), claimReportExportBatch(10)]);
    const claimedIdsA = batchA.map((r) => r.id);
    const claimedIdsB = batchB.map((r) => r.id);
    const overlap = claimedIdsA.filter((id) => claimedIdsB.includes(id));

    expect(overlap).toHaveLength(0); // no export appears in both batches
    const totalClaimed = new Set([...claimedIdsA, ...claimedIdsB]);
    expect(totalClaimed.size).toBe(ids.length); // every export claimed exactly once, none lost, none duplicated
  });

  it("a PROCESSING export with an unexpired lease is NOT reclaimed by a concurrent caller", async () => {
    const { attemptClaimReportExport } = await import("../report-export-queue");
    const id = await createQueuedExport();

    const first = await attemptClaimReportExport(id);
    expect(first.claimed).toBe(true);

    const second = await attemptClaimReportExport(id);
    expect(second.claimed).toBe(false); // still within lease — not reclaimable yet
  });

  it("a PROCESSING export with an EXPIRED lease IS reclaimed, and attemptCount increments again", async () => {
    const { attemptClaimReportExport } = await import("../report-export-queue");
    const id = await createQueuedExport();

    const first = await attemptClaimReportExport(id);
    expect(first.claimed).toBe(true);

    // Simulate a crashed worker: force the lease into the past directly.
    await prisma.reportExport.update({ where: { id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });

    const second = await attemptClaimReportExport(id);
    expect(second.claimed).toBe(true);

    const row = await prisma.reportExport.findUniqueOrThrow({ where: { id } });
    expect(row.attemptCount).toBe(2);
  });

  it("a QUEUED export with nextAttemptAt in the future is NOT claimed (backoff is honored)", async () => {
    const id = await createQueuedExport();
    await prisma.reportExport.update({ where: { id }, data: { nextAttemptAt: new Date(Date.now() + 60_000) } });

    const { attemptClaimReportExport } = await import("../report-export-queue");
    const result = await attemptClaimReportExport(id);
    expect(result.claimed).toBe(false);
  });

  it("a QUEUED export whose nextAttemptAt has already passed IS claimed", async () => {
    const id = await createQueuedExport();
    await prisma.reportExport.update({ where: { id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });

    const { attemptClaimReportExport } = await import("../report-export-queue");
    const result = await attemptClaimReportExport(id);
    expect(result.claimed).toBe(true);
  });

  it("a COMPLETED export is never reclaimed regardless of lease/nextAttemptAt state", async () => {
    const id = await createQueuedExport();
    await prisma.reportExport.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });

    const { attemptClaimReportExport } = await import("../report-export-queue");
    const result = await attemptClaimReportExport(id);
    expect(result.claimed).toBe(false);
  });

  it("claimReportExportBatch respects the batch-size limit under real contention", async () => {
    const { claimReportExportBatch } = await import("../report-export-queue");
    await Promise.all(Array.from({ length: 8 }, () => createQueuedExport()));

    const batch = await claimReportExportBatch(3);
    expect(batch.length).toBeLessThanOrEqual(3);
  });
});
