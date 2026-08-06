import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstBatch = vi.fn();
const updateBatch = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    importBatch: {
      findFirst: (...args: unknown[]) => findFirstBatch(...args),
      update: (...args: unknown[]) => updateBatch(...args),
    },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "batch-1",
    organizationId: "org-a",
    status: "UPLOADED",
    ...overrides,
  };
}

describe("canTransitionImportBatch / isTerminalImportBatchStatus", () => {
  it("allows the full happy path in sequence", async () => {
    const { canTransitionImportBatch } = await import("../batch-state-machine");
    const path = ["UPLOADED", "ANALYZING", "READY_FOR_REVIEW", "IMPORTING", "COMPLETED"] as const;
    for (let i = 1; i < path.length; i += 1) {
      expect(canTransitionImportBatch(path[i - 1], path[i])).toBe(true);
    }
  });

  it("rejects an impossible jump from UPLOADED to COMPLETED", async () => {
    const { canTransitionImportBatch } = await import("../batch-state-machine");
    expect(canTransitionImportBatch("UPLOADED", "COMPLETED")).toBe(false);
  });

  it("allows IMPORTING to pause at PAUSED_PLAN_LIMIT, and PAUSED_PLAN_LIMIT to resume back to IMPORTING", async () => {
    const { canTransitionImportBatch } = await import("../batch-state-machine");
    expect(canTransitionImportBatch("IMPORTING", "PAUSED_PLAN_LIMIT")).toBe(true);
    expect(canTransitionImportBatch("PAUSED_PLAN_LIMIT", "IMPORTING")).toBe(true);
  });

  it("allows retrying from FAILED back to ANALYZING", async () => {
    const { canTransitionImportBatch } = await import("../batch-state-machine");
    expect(canTransitionImportBatch("FAILED", "ANALYZING")).toBe(true);
  });

  it("COMPLETED and CANCELED are the only true dead ends", async () => {
    const { canTransitionImportBatch, isTerminalImportBatchStatus } = await import("../batch-state-machine");
    expect(isTerminalImportBatchStatus("COMPLETED")).toBe(true);
    expect(isTerminalImportBatchStatus("CANCELED")).toBe(true);
    expect(canTransitionImportBatch("COMPLETED", "IMPORTING")).toBe(false);
    expect(canTransitionImportBatch("CANCELED", "IMPORTING")).toBe(false);
    expect(isTerminalImportBatchStatus("PAUSED_PLAN_LIMIT")).toBe(false);
  });
});

describe("transitionImportBatch", () => {
  it("scopes the batch lookup by organizationId and throws when it doesn't match", async () => {
    findFirstBatch.mockResolvedValueOnce(null);
    const { transitionImportBatch } = await import("../batch-state-machine");
    const { ImportError } = await import("../errors");
    await expect(transitionImportBatch({ batchId: "batch-1", organizationId: "org-b", to: "ANALYZING" })).rejects.toBeInstanceOf(ImportError);
    expect(findFirstBatch).toHaveBeenCalledWith({ where: { id: "batch-1", organizationId: "org-b" } });
  });

  it("throws for a disallowed transition and never writes", async () => {
    findFirstBatch.mockResolvedValueOnce(makeBatch({ status: "UPLOADED" }));
    const { transitionImportBatch } = await import("../batch-state-machine");
    await expect(transitionImportBatch({ batchId: "batch-1", organizationId: "org-a", to: "COMPLETED" })).rejects.toThrow();
    expect(updateBatch).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("is idempotent: transitioning to the batch's current status is a no-op, no write, no audit event", async () => {
    findFirstBatch.mockResolvedValueOnce(makeBatch({ status: "IMPORTING" }));
    const { transitionImportBatch } = await import("../batch-state-machine");
    const result = await transitionImportBatch({ batchId: "batch-1", organizationId: "org-a", to: "IMPORTING" });
    expect(result.status).toBe("IMPORTING");
    expect(updateBatch).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("writes the correct timestamp field for the target status", async () => {
    findFirstBatch.mockResolvedValueOnce(makeBatch({ status: "READY_FOR_REVIEW" }));
    updateBatch.mockResolvedValueOnce(makeBatch({ status: "IMPORTING" }));
    const { transitionImportBatch } = await import("../batch-state-machine");
    await transitionImportBatch({ batchId: "batch-1", organizationId: "org-a", to: "IMPORTING" });
    const call = updateBatch.mock.calls[0][0];
    expect(call.data.status).toBe("IMPORTING");
    expect(call.data.importStartedAt).toBeInstanceOf(Date);
  });

  it("merges extraData into the same update call rather than a second write", async () => {
    findFirstBatch.mockResolvedValueOnce(makeBatch({ status: "UPLOADED" }));
    updateBatch.mockResolvedValueOnce(makeBatch({ status: "ANALYZING" }));
    const { transitionImportBatch } = await import("../batch-state-machine");
    await transitionImportBatch({ batchId: "batch-1", organizationId: "org-a", to: "ANALYZING", extraData: { claimedAt: null } });
    expect(updateBatch).toHaveBeenCalledTimes(1);
    expect(updateBatch.mock.calls[0][0].data.claimedAt).toBeNull();
  });

  it("writes an audit event recording the previous and new status", async () => {
    findFirstBatch.mockResolvedValueOnce(makeBatch({ status: "UPLOADED" }));
    updateBatch.mockResolvedValueOnce(makeBatch({ status: "ANALYZING" }));
    const { transitionImportBatch } = await import("../batch-state-machine");
    await transitionImportBatch({ batchId: "batch-1", organizationId: "org-a", to: "ANALYZING", actorUserId: "user-1", actorEmail: "a@example.com" });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-a",
        actorUserId: "user-1",
        action: "import_batch.analyzing",
        entityType: "import_batch",
        entityId: "batch-1",
        metadata: expect.objectContaining({ previousStatus: "UPLOADED", newStatus: "ANALYZING" }),
      })
    );
  });

  it("never includes row data in the audit event metadata (only status strings)", async () => {
    findFirstBatch.mockResolvedValueOnce(makeBatch({ status: "READY_FOR_REVIEW" }));
    updateBatch.mockResolvedValueOnce(makeBatch({ status: "IMPORTING" }));
    const { transitionImportBatch } = await import("../batch-state-machine");
    await transitionImportBatch({ batchId: "batch-1", organizationId: "org-a", to: "IMPORTING" });
    const metadata = createAuditEvent.mock.calls[0][0].metadata;
    expect(Object.keys(metadata).sort()).toEqual(["newStatus", "previousStatus"]);
  });
});
