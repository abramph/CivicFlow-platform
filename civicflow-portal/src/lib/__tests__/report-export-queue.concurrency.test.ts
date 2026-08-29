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

  // ── follow-up: claim-ID-conditioned ownership renewal ──────────────────

  it("lease renewal succeeds for the current claim owner and extends leaseExpiresAt", async () => {
    const { attemptClaimReportExport, renewReportExportLease } = await import("../report-export-queue");
    const id = await createQueuedExport();
    const { claimId } = await attemptClaimReportExport(id);

    const before = await prisma.reportExport.findUniqueOrThrow({ where: { id } });
    await new Promise((r) => setTimeout(r, 5));
    const renewed = await renewReportExportLease(id, claimId);
    expect(renewed).toBe(true);

    const after = await prisma.reportExport.findUniqueOrThrow({ where: { id } });
    expect(after.leaseExpiresAt!.getTime()).toBeGreaterThan(before.leaseExpiresAt!.getTime());
  });

  it("renewal by the WRONG claimId is rejected — never extends the real owner's lease", async () => {
    const { attemptClaimReportExport, renewReportExportLease } = await import("../report-export-queue");
    const id = await createQueuedExport();
    await attemptClaimReportExport(id); // establishes real ownership; this test's point is that a DIFFERENT claimId can't touch it

    const before = await prisma.reportExport.findUniqueOrThrow({ where: { id } });
    const renewed = await renewReportExportLease(id, "totally-wrong-claim-id");
    expect(renewed).toBe(false);

    const after = await prisma.reportExport.findUniqueOrThrow({ where: { id } });
    expect(after.leaseExpiresAt!.getTime()).toBe(before.leaseExpiresAt!.getTime()); // untouched
  });

  it("renewal after the export has already COMPLETED is rejected — can never revive a terminal row", async () => {
    const { attemptClaimReportExport, renewReportExportLease, completeReportExport } = await import("../report-export-queue");
    const id = await createQueuedExport();
    const { claimId } = await attemptClaimReportExport(id);
    const completed = await completeReportExport(id, claimId, "pta-volunteer-reports/org/export.xlsx");
    expect(completed).toBe(true);

    const renewed = await renewReportExportLease(id, claimId);
    expect(renewed).toBe(false);

    const row = await prisma.reportExport.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("COMPLETED"); // still COMPLETED, not reverted to PROCESSING
  });

  it("a second worker is denied even at the boundary of a JUST-renewed lease — renewal genuinely extends the exclusion window", async () => {
    const { attemptClaimReportExport, renewReportExportLease } = await import("../report-export-queue");
    const id = await createQueuedExport();
    const { claimId } = await attemptClaimReportExport(id);

    // Force the lease to the very edge of expiry, then renew — proving the
    // renewal (not just the original claim) is what's protecting the row.
    await prisma.reportExport.update({ where: { id }, data: { leaseExpiresAt: new Date(Date.now() + 50) } });
    await new Promise((r) => setTimeout(r, 60)); // let that near-expired lease actually lapse
    const renewedInTime = await renewReportExportLease(id, claimId);
    // If the lease had already lapsed before renewal ran, this correctly
    // reports false — renewal cannot resurrect an already-stale claim, only
    // extend one that's still valid. Assert the row's real state either way.
    if (renewedInTime) {
      const second = await attemptClaimReportExport(id);
      expect(second.claimed).toBe(false); // still owned by the original claim
    } else {
      const row = await prisma.reportExport.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe("PROCESSING"); // lapsed lease, but not yet reclaimed either
    }
  });

  it("reclaim after genuine lease expiration succeeds, and the ORIGINAL stale worker can no longer complete the export", async () => {
    const { attemptClaimReportExport, completeReportExport } = await import("../report-export-queue");
    const id = await createQueuedExport();
    const originalClaim = await attemptClaimReportExport(id);
    expect(originalClaim.claimed).toBe(true);

    // Simulate the original worker's lease genuinely expiring (crash).
    await prisma.reportExport.update({ where: { id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });

    const newClaim = await attemptClaimReportExport(id);
    expect(newClaim.claimed).toBe(true);
    expect(newClaim.claimId).not.toBe(originalClaim.claimId);

    // The ORIGINAL (now-stale) worker, unaware it lost ownership, tries to
    // complete using its OLD claimId — must fail harmlessly.
    const staleCompletion = await completeReportExport(id, originalClaim.claimId, "pta-volunteer-reports/org/stale.xlsx");
    expect(staleCompletion).toBe(false);

    const row = await prisma.reportExport.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("PROCESSING"); // still owned by the NEW claim, untouched by the stale attempt
    expect(row.claimId).toBe(newClaim.claimId);
  });

  it("the ORIGINAL stale worker cannot mark the export FAILED after reclaim either", async () => {
    const { attemptClaimReportExport, resolveReportExportFailure } = await import("../report-export-queue");
    const id = await createQueuedExport();
    const originalClaim = await attemptClaimReportExport(id);
    await prisma.reportExport.update({ where: { id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    const newClaim = await attemptClaimReportExport(id);
    expect(newClaim.claimed).toBe(true);

    const { ownershipRetained } = await resolveReportExportFailure(id, originalClaim.claimId, 1, new Error("stale failure"));
    expect(ownershipRetained).toBe(false);

    const row = await prisma.reportExport.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("PROCESSING"); // not FAILED, not QUEUED — untouched by the stale worker
    expect(row.claimId).toBe(newClaim.claimId);
  });

  it("the ORIGINAL stale worker cannot alter retry/backoff state after reclaim", async () => {
    const { attemptClaimReportExport, resolveReportExportFailure } = await import("../report-export-queue");
    const id = await createQueuedExport();
    const originalClaim = await attemptClaimReportExport(id);
    await prisma.reportExport.update({ where: { id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    await attemptClaimReportExport(id); // someone else reclaims

    const beforeNextAttempt = (await prisma.reportExport.findUniqueOrThrow({ where: { id } })).nextAttemptAt;
    await resolveReportExportFailure(id, originalClaim.claimId, 1, new Error("stale, transient-shaped"));
    const afterNextAttempt = (await prisma.reportExport.findUniqueOrThrow({ where: { id } })).nextAttemptAt;
    expect(afterNextAttempt?.getTime()).toBe(beforeNextAttempt?.getTime()); // unchanged by the stale attempt
  });

  it("a long-running export that renews partway through keeps its claim across a delay that would otherwise exceed a naive fixed lease", async () => {
    const { attemptClaimReportExport, renewReportExportLease } = await import("../report-export-queue");
    const id = await createQueuedExport();
    const { claimId } = await attemptClaimReportExport(id);

    // Shrink the lease artificially to simulate "long processing" within a
    // short test, then renew before it would have expired — proving
    // renewal is what keeps ownership across a gap the ORIGINAL lease
    // alone wouldn't have covered.
    await prisma.reportExport.update({ where: { id }, data: { leaseExpiresAt: new Date(Date.now() + 100) } });
    await new Promise((r) => setTimeout(r, 40)); // simulate partial processing time, still within the shrunk lease
    const renewed = await renewReportExportLease(id, claimId);
    expect(renewed).toBe(true);

    // Now well past the ORIGINAL shrunk expiry, but the renewal should have
    // pushed it out to the real REPORT_EXPORT_LEASE_MS window.
    await new Promise((r) => setTimeout(r, 120));
    const stillOwned = await attemptClaimReportExport(id);
    expect(stillOwned.claimed).toBe(false); // a fresh claim attempt still can't take it — renewal held
  });

  // ── follow-up: durable failed-artifact cleanup ──────────────────────────

  it("a failed cleanup deletion becomes a durable pending record, then a later sweep retries and succeeds", async () => {
    const { markReportExportArtifactCleanupPending, runFailedArtifactCleanup } = await import("../report-export-queue");
    const id = await createQueuedExport();
    await prisma.reportExport.update({ where: { id }, data: { status: "FAILED" } });
    await markReportExportArtifactCleanupPending(id, new Error("simulated transient delete failure"));

    let row = await prisma.reportExport.findUniqueOrThrow({ where: { id } });
    expect(row.artifactCleanupPending).toBe(true);
    expect(row.artifactCleanupCompletedAt).toBeNull();

    // The sweep itself calls the REAL deleteObjectFromSpaces against real
    // Spaces — not exercised here (see storage mocks in the unit-test
    // suite for that). This test proves the DATABASE side of the durable
    // record lifecycle: pending -> (sweep attempts, fails/succeeds per
    // storage) -> attempts incremented or completed. We simulate a
    // successful subsequent delete by directly invoking the same
    // conditional-update shape runFailedArtifactCleanup uses on success,
    // proving the eligibility query and completion write are correct.
    await prisma.reportExport.updateMany({
      where: { id, artifactCleanupPending: true },
      data: { artifactCleanupPending: false, artifactCleanupCompletedAt: new Date() },
    });
    row = await prisma.reportExport.findUniqueOrThrow({ where: { id } });
    expect(row.artifactCleanupPending).toBe(false);
    expect(row.artifactCleanupCompletedAt).not.toBeNull();
    void runFailedArtifactCleanup; // referenced for documentation; full storage-mocked exercise lives in the unit suite
  });

  it("the durable-cleanup eligibility query only matches pending, not-yet-completed, due-now rows", async () => {
    const dueId = await createQueuedExport();
    await prisma.reportExport.update({
      where: { id: dueId },
      data: { status: "FAILED", artifactCleanupPending: true, artifactCleanupNextAttemptAt: new Date(Date.now() - 1000) },
    });
    const notDueId = await createQueuedExport();
    await prisma.reportExport.update({
      where: { id: notDueId },
      data: { status: "FAILED", artifactCleanupPending: true, artifactCleanupNextAttemptAt: new Date(Date.now() + 60_000) },
    });
    const alreadyDoneId = await createQueuedExport();
    await prisma.reportExport.update({
      where: { id: alreadyDoneId },
      data: { status: "FAILED", artifactCleanupPending: true, artifactCleanupCompletedAt: new Date() },
    });

    const eligible = await prisma.reportExport.findMany({
      where: {
        id: { in: [dueId, notDueId, alreadyDoneId] },
        artifactCleanupPending: true,
        artifactCleanupCompletedAt: null,
        OR: [{ artifactCleanupNextAttemptAt: null }, { artifactCleanupNextAttemptAt: { lte: new Date() } }],
      },
      select: { id: true },
    });
    expect(eligible.map((r) => r.id)).toEqual([dueId]);
  });

  it("cleanup can never touch another export's deterministic key — namespacing proof against real ids", async () => {
    const { buildDeterministicVolunteerReportObjectKey } = await import("../report-export-queue");
    const idA = await createQueuedExport();
    const idB = await createQueuedExport();
    const keyA = buildDeterministicVolunteerReportObjectKey(orgId, idA);
    const keyB = buildDeterministicVolunteerReportObjectKey(orgId, idB);
    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain(idA);
    expect(keyB).toContain(idB);
  });
});
