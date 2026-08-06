import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "officer-1", userEmail: "officer@example.com" },
      organizationId: "org-a",
      role: "ORG_ADMIN",
      can: (permission: string) => ["imports:read", "imports:create", "imports:review", "imports:resume", "imports:cancel", "imports:resolve-duplicates"].includes(permission),
    }),
  };
});

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const findFirstImportBatch = vi.fn();
const findFirstImportRow = vi.fn();
const updateImportRow = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    importBatch: { findFirst: (...args: unknown[]) => findFirstImportBatch(...args) },
    importRow: {
      findFirst: (...args: unknown[]) => findFirstImportRow(...args),
      update: (...args: unknown[]) => updateImportRow(...args),
    },
  },
}));

const applyDefaultDecisions = vi.fn().mockResolvedValue(undefined);
const executeBatch = vi.fn().mockResolvedValue(undefined);
const resumeBatch = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/imports/engine", () => ({
  applyDefaultDecisions: (...args: unknown[]) => applyDefaultDecisions(...args),
  executeBatch: (...args: unknown[]) => executeBatch(...args),
  resumeBatch: (...args: unknown[]) => resumeBatch(...args),
}));

const transitionImportBatch = vi.fn().mockResolvedValue({ status: "CANCELED" });
vi.mock("@/lib/imports/batch-state-machine", () => ({
  transitionImportBatch: (...args: unknown[]) => transitionImportBatch(...args),
}));

import { POST as decidePOST } from "@/app/api/imports/[id]/rows/[rowId]/decide/route";
import { POST as startPOST } from "@/app/api/imports/[id]/start/route";
import { POST as resumePOST } from "@/app/api/imports/[id]/resume/route";
import { POST as cancelPOST } from "@/app/api/imports/[id]/cancel/route";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/imports/[id]/rows/[rowId]/decide", () => {
  it("rejects a decision on a batch that isn't READY_FOR_REVIEW", async () => {
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "IMPORTING" });

    const response = await decidePOST(
      jsonRequest("https://portal.test/api/imports/batch-1/rows/row-1/decide", { decision: "SKIP" }),
      { params: Promise.resolve({ id: "batch-1", rowId: "row-1" }) }
    );

    expect(response.status).toBe(409);
    expect(updateImportRow).not.toHaveBeenCalled();
  });

  it("rejects redeciding a row already in a terminal status", async () => {
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "READY_FOR_REVIEW" });
    findFirstImportRow.mockResolvedValueOnce({ id: "row-1", status: "IMPORTED", rowNumber: 2 });

    const response = await decidePOST(
      jsonRequest("https://portal.test/api/imports/batch-1/rows/row-1/decide", { decision: "SKIP" }),
      { params: Promise.resolve({ id: "batch-1", rowId: "row-1" }) }
    );

    expect(response.status).toBe(409);
    expect(updateImportRow).not.toHaveBeenCalled();
  });

  it("records a valid decision and audits it", async () => {
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "READY_FOR_REVIEW" });
    findFirstImportRow.mockResolvedValueOnce({ id: "row-1", status: "NEW", rowNumber: 2 });
    updateImportRow.mockResolvedValueOnce({ id: "row-1", decision: "IMPORT_NEW" });

    const response = await decidePOST(
      jsonRequest("https://portal.test/api/imports/batch-1/rows/row-1/decide", { decision: "IMPORT_NEW" }),
      { params: Promise.resolve({ id: "batch-1", rowId: "row-1" }) }
    );

    expect(response.status).toBe(200);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "import_row.decided" }));
  });
});

describe("POST /api/imports/[id]/start", () => {
  it("rejects starting a batch that isn't READY_FOR_REVIEW", async () => {
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "IMPORTING" });

    const response = await startPOST(new Request("https://portal.test/api/imports/batch-1/start", { method: "POST" }), {
      params: Promise.resolve({ id: "batch-1" }),
    });

    expect(response.status).toBe(409);
    expect(applyDefaultDecisions).not.toHaveBeenCalled();
  });

  it("applies default decisions, transitions to IMPORTING, and kicks off the first execute tick", async () => {
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "READY_FOR_REVIEW" });
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "IMPORTING" });

    const response = await startPOST(new Request("https://portal.test/api/imports/batch-1/start", { method: "POST" }), {
      params: Promise.resolve({ id: "batch-1" }),
    });

    expect(response.status).toBe(200);
    expect(applyDefaultDecisions).toHaveBeenCalledWith("batch-1");
    expect(transitionImportBatch).toHaveBeenCalledWith(expect.objectContaining({ to: "IMPORTING" }));
    expect(executeBatch).toHaveBeenCalledWith("batch-1", "org-a");
  });
});

describe("POST /api/imports/[id]/resume", () => {
  it("delegates to resumeBatch() with the caller as actor", async () => {
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "PAUSED_PLAN_LIMIT" });

    const response = await resumePOST(new Request("https://portal.test/api/imports/batch-1/resume", { method: "POST" }), {
      params: Promise.resolve({ id: "batch-1" }),
    });

    expect(response.status).toBe(200);
    expect(resumeBatch).toHaveBeenCalledWith("batch-1", "org-a", "officer-1");
  });
});

describe("POST /api/imports/[id]/cancel", () => {
  it("transitions the batch to CANCELED without touching already-imported rows", async () => {
    const response = await cancelPOST(new Request("https://portal.test/api/imports/batch-1/cancel", { method: "POST" }), {
      params: Promise.resolve({ id: "batch-1" }),
    });

    expect(response.status).toBe(200);
    expect(transitionImportBatch).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: "batch-1", organizationId: "org-a", to: "CANCELED" })
    );
  });
});
