import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Publish Progression Results — the explicit, audited disclosure step.
 * Covers publishability validation, the blocking policy, idempotency,
 * optimistic concurrency, withdrawal, audit events, and the rollback
 * interaction.
 */

const findFirstBatch = vi.fn();
const updateManyBatch = vi.fn();
const findUniqueProfile = vi.fn();
const findManyAudit = vi.fn();
const transaction = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaProfile: { findUnique: (...a: unknown[]) => findUniqueProfile(...a) },
    ptaStudentProgressionBatch: {
      findFirst: (...a: unknown[]) => findFirstBatch(...a),
      updateMany: (...a: unknown[]) => updateManyBatch(...a),
    },
    auditEvent: { findMany: (...a: unknown[]) => findManyAudit(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

const isPtaStudentProgressionPlatformEnabled = vi.fn();
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, isPtaStudentProgressionPlatformEnabled: () => isPtaStudentProgressionPlatformEnabled() };
});

import {
  getProgressionPublicationStatus,
  publishProgressionResults,
  unpublishProgressionResults,
  getProgressionPublicationHistory,
} from "../progression-publication";

const ORG = "org-1";
const BATCH = "batch-1";
const ACTOR = { actorUserId: "user-1", actorEmail: "admin@example.org" };

function record(overrides: Record<string, unknown> = {}) {
  return { id: "r-1", outcome: "PROMOTE", status: "APPLIED", targetEnrollmentId: "e-1", ...overrides };
}

function batch(overrides: Record<string, unknown> = {}) {
  return {
    id: BATCH,
    status: "COMMITTED",
    publicationStatus: "UNPUBLISHED",
    publicationVersion: 0,
    publishedAt: null,
    publishedByUserId: null,
    unpublishedAt: null,
    unpublishedByUserId: null,
    publishIdempotencyKey: null,
    fromSchoolYearId: "y-from",
    toSchoolYearId: "y-to",
    fromSchoolYear: { label: "2026-2027" },
    toSchoolYear: { label: "2027-2028" },
    records: [record()],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isPtaStudentProgressionPlatformEnabled.mockReturnValue(true);
  findUniqueProfile.mockResolvedValue({ studentProgressionEnabled: true });
  findFirstBatch.mockResolvedValue(batch());
  updateManyBatch.mockResolvedValue({ count: 1 });
  // Run the transaction callback against the same mocked client.
  transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      ptaStudentProgressionBatch: { updateMany: (...a: unknown[]) => updateManyBatch(...a) },
    })
  );
});

describe("publication — feature flags and tenant scope", () => {
  it("denies when the platform flag is off, before loading the batch", async () => {
    isPtaStudentProgressionPlatformEnabled.mockReturnValue(false);
    await expect(
      publishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 0, idempotencyKey: "k" })
    ).rejects.toMatchObject({ code: "PTA_STUDENT_PROGRESSION_PLATFORM_DISABLED" });
    expect(findFirstBatch).not.toHaveBeenCalled();
  });

  it("denies when the organization flag is off", async () => {
    findUniqueProfile.mockResolvedValue({ studentProgressionEnabled: false });
    await expect(
      publishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 0, idempotencyKey: "k" })
    ).rejects.toMatchObject({ code: "PTA_STUDENT_PROGRESSION_DISABLED" });
  });

  it("scopes the batch lookup by organization — a cross-organization batch id is not found", async () => {
    findFirstBatch.mockResolvedValue(null);
    await expect(
      publishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: "batch-of-another-org", publicationVersion: 0, idempotencyKey: "k" })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_BATCH_NOT_FOUND" });
    expect(findFirstBatch.mock.calls[0][0].where).toEqual({ id: "batch-of-another-org", organizationId: ORG });
    expect(updateManyBatch).not.toHaveBeenCalled();
  });
});

describe("publication — publishability validation", () => {
  it("rejects a batch that has not been committed", async () => {
    findFirstBatch.mockResolvedValue(batch({ status: "PREVIEWED" }));
    await expect(
      publishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 0, idempotencyKey: "k" })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_NOT_COMMITTED" });
    expect(updateManyBatch).not.toHaveBeenCalled();
  });

  it("rejects a rolled-back batch", async () => {
    findFirstBatch.mockResolvedValue(batch({ status: "ROLLED_BACK" }));
    await expect(
      publishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 0, idempotencyKey: "k" })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_ROLLED_BACK" });
  });

  it("BLOCKS publication when an unresolved NEEDS_REVIEW record remains — never partially publishes", async () => {
    findFirstBatch.mockResolvedValue(
      batch({ records: [record(), record({ id: "r-2", outcome: "NEEDS_REVIEW", status: "PLANNED", targetEnrollmentId: null })] })
    );
    await expect(
      publishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 0, idempotencyKey: "k" })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_PUBLISH_BLOCKED" });
    expect(updateManyBatch).not.toHaveBeenCalled();
  });

  it("BLOCKS publication when a record FAILED during commit", async () => {
    findFirstBatch.mockResolvedValue(batch({ records: [record(), record({ id: "r-2", status: "FAILED" })] }));
    await expect(
      publishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 0, idempotencyKey: "k" })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_PUBLISH_BLOCKED" });
  });

  it("BLOCKS publication when an APPLIED record has no target enrollment", async () => {
    findFirstBatch.mockResolvedValue(batch({ records: [record({ targetEnrollmentId: null })] }));
    await expect(
      publishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 0, idempotencyKey: "k" })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_PUBLISH_BLOCKED" });
  });

  it("records an audit event, with counts but no student names, when publication is blocked", async () => {
    findFirstBatch.mockResolvedValue(
      batch({ records: [record({ id: "r-2", outcome: "NEEDS_REVIEW", status: "PLANNED", targetEnrollmentId: null })] })
    );
    await expect(
      publishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 0, idempotencyKey: "k" })
    ).rejects.toThrow();
    const event = createAuditEvent.mock.calls[0][0];
    expect(event.action).toBe("pta.progression.publish.blocked");
    expect(event.metadata.outcome).toBe("BLOCKED");
    expect(event.metadata.blockingCount).toBe(1);
    expect(JSON.stringify(event.metadata)).not.toContain("studentId");
  });

  it("rejects when there is nothing eligible to publish", async () => {
    findFirstBatch.mockResolvedValue(batch({ records: [record({ outcome: "GRADUATE" })] }));
    await expect(
      publishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 0, idempotencyKey: "k" })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_PUBLISH_BLOCKED" });
  });

  it("counts graduated/transferred/withdrawn/excluded as excluded, not blocking", async () => {
    findFirstBatch.mockResolvedValue(
      batch({
        records: [
          record(),
          record({ id: "r-2", outcome: "GRADUATE", targetEnrollmentId: null }),
          record({ id: "r-3", outcome: "TRANSFER", targetEnrollmentId: null }),
          record({ id: "r-4", outcome: "WITHDRAW", targetEnrollmentId: null }),
          record({ id: "r-5", outcome: "EXCLUDE", targetEnrollmentId: null }),
        ],
      })
    );
    const status = await getProgressionPublicationStatus(ORG, BATCH);
    expect(status.eligibleCount).toBe(1);
    expect(status.excludedCount).toBe(4);
    expect(status.blockingCount).toBe(0);
    expect(status.canPublish).toBe(true);
  });
});

describe("publication — publishing", () => {
  it("publishes, stamps actor/timestamp, bumps the version, and records an audit event", async () => {
    const result = await publishProgressionResults({
      ...ACTOR,
      organizationId: ORG,
      batchId: BATCH,
      publicationVersion: 0,
      idempotencyKey: "key-1",
    });
    expect(result).toMatchObject({ publicationStatus: "PUBLISHED", publicationVersion: 1, eligibleCount: 1, idempotentReplay: false });

    const update = updateManyBatch.mock.calls[0][0];
    expect(update.data).toMatchObject({
      publicationStatus: "PUBLISHED",
      publishedByUserId: "user-1",
      publishIdempotencyKey: "key-1",
    });
    expect(update.data.publicationVersion).toEqual({ increment: 1 });

    const event = createAuditEvent.mock.calls.at(-1)![0];
    expect(event.action).toBe("pta.progression.published");
    expect(event.metadata).toMatchObject({ outcome: "PUBLISHED", fromSchoolYear: "2026-2027", toSchoolYear: "2027-2028", eligibleCount: 1 });
  });

  it("guards with optimistic concurrency — the update requires the caller's version AND a non-published state", async () => {
    await publishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 3, idempotencyKey: "k" });
    const where = updateManyBatch.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: BATCH, organizationId: ORG, publicationVersion: 3 });
    expect(where.publicationStatus).toEqual({ in: ["UNPUBLISHED", "WITHDRAWN"] });
  });

  it("a concurrent publisher that loses the race fails with a stale error instead of double-publishing", async () => {
    updateManyBatch.mockResolvedValue({ count: 0 });
    await expect(
      publishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 0, idempotencyKey: "k" })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_PUBLICATION_STALE" });
  });

  it("a stale publicationVersion is rejected", async () => {
    updateManyBatch.mockResolvedValue({ count: 0 });
    await expect(
      publishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 99, idempotencyKey: "k" })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_PUBLICATION_STALE" });
  });

  it("is idempotent — a retried publish with the same key changes nothing and is not a second disclosure", async () => {
    findFirstBatch.mockResolvedValue(
      batch({ publicationStatus: "PUBLISHED", publicationVersion: 1, publishedAt: new Date("2026-09-03T10:00:00Z"), publishIdempotencyKey: "key-1" })
    );
    const result = await publishProgressionResults({
      ...ACTOR,
      organizationId: ORG,
      batchId: BATCH,
      publicationVersion: 1,
      idempotencyKey: "key-1",
    });
    expect(result.idempotentReplay).toBe(true);
    expect(result.publicationVersion).toBe(1);
    expect(updateManyBatch).not.toHaveBeenCalled();
    expect(createAuditEvent.mock.calls[0][0].action).toBe("pta.progression.publish.replayed");
  });

  it("a DIFFERENT key against an already-published batch is a stale conflict, not a silent replay", async () => {
    findFirstBatch.mockResolvedValue(batch({ publicationStatus: "PUBLISHED", publicationVersion: 1, publishIdempotencyKey: "key-1" }));
    updateManyBatch.mockResolvedValue({ count: 0 });
    await expect(
      publishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 1, idempotencyKey: "key-2" })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_PUBLICATION_STALE" });
  });

  it("publishes a CORRECTED batch too — correction does not make results unpublishable", async () => {
    findFirstBatch.mockResolvedValue(batch({ status: "CORRECTED" }));
    await expect(
      publishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 0, idempotencyKey: "k" })
    ).resolves.toMatchObject({ publicationStatus: "PUBLISHED" });
  });
});

describe("publication — withdrawal", () => {
  it("withdraws a published batch, stamping actor and time, and records the irreversibility of prior disclosure", async () => {
    findFirstBatch.mockResolvedValue(
      batch({ publicationStatus: "PUBLISHED", publicationVersion: 1, publishedAt: new Date("2026-09-03T10:00:00Z") })
    );
    const result = await unpublishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 1 });
    expect(result).toMatchObject({ publicationStatus: "WITHDRAWN", publicationVersion: 2 });

    const update = updateManyBatch.mock.calls[0][0];
    expect(update.data).toMatchObject({ publicationStatus: "WITHDRAWN", unpublishedByUserId: "user-1", publishIdempotencyKey: null });

    const event = createAuditEvent.mock.calls.at(-1)![0];
    expect(event.action).toBe("pta.progression.unpublished");
    expect(event.metadata.priorDisclosureIrreversible).toBe(true);
  });

  it("refuses to withdraw a batch that is not published", async () => {
    findFirstBatch.mockResolvedValue(batch({ publicationStatus: "UNPUBLISHED" }));
    await expect(
      unpublishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 0 })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_NOT_PUBLISHED" });
    expect(updateManyBatch).not.toHaveBeenCalled();
  });

  it("a losing concurrent withdrawal fails cleanly", async () => {
    findFirstBatch.mockResolvedValue(batch({ publicationStatus: "PUBLISHED", publicationVersion: 1 }));
    updateManyBatch.mockResolvedValue({ count: 0 });
    await expect(
      unpublishProgressionResults({ ...ACTOR, organizationId: ORG, batchId: BATCH, publicationVersion: 1 })
    ).rejects.toMatchObject({ code: "PTA_PROGRESSION_PUBLICATION_STALE" });
  });
});

describe("publication — status and history", () => {
  it("reports an unpublished committed batch as publishable", async () => {
    const status = await getProgressionPublicationStatus(ORG, BATCH);
    expect(status).toMatchObject({
      publicationStatus: "UNPUBLISHED",
      publicationVersion: 0,
      fromSchoolYear: "2026-2027",
      toSchoolYear: "2027-2028",
      eligibleCount: 1,
      blockingCount: 0,
      canPublish: true,
    });
  });

  it("reports an already-published batch as not re-publishable", async () => {
    findFirstBatch.mockResolvedValue(batch({ publicationStatus: "PUBLISHED", publicationVersion: 1, publishedAt: new Date() }));
    const status = await getProgressionPublicationStatus(ORG, BATCH);
    expect(status.canPublish).toBe(false);
    expect(status.publicationStatus).toBe("PUBLISHED");
  });

  it("explains why an uncommitted batch cannot be published", async () => {
    findFirstBatch.mockResolvedValue(batch({ status: "PREVIEWED" }));
    const status = await getProgressionPublicationStatus(ORG, BATCH);
    expect(status.canPublish).toBe(false);
    expect(status.blockingReasons.join(" ")).toContain("not been committed");
  });

  it("returns publication history scoped to the organization and batch", async () => {
    findManyAudit.mockResolvedValue([{ id: "a-1", action: "pta.progression.published", actorEmail: "admin@example.org", createdAt: new Date(), after: {} }]);
    const history = await getProgressionPublicationHistory(ORG, BATCH);
    expect(history).toHaveLength(1);
    expect(findManyAudit.mock.calls[0][0].where).toMatchObject({
      organizationId: ORG,
      resource: "PtaStudentProgressionBatch",
      resourceId: BATCH,
    });
  });

  it("refuses history for a batch belonging to another organization", async () => {
    findFirstBatch.mockResolvedValue(null);
    await expect(getProgressionPublicationHistory(ORG, "other-org-batch")).rejects.toMatchObject({
      code: "PTA_PROGRESSION_BATCH_NOT_FOUND",
    });
    expect(findManyAudit).not.toHaveBeenCalled();
  });
});
