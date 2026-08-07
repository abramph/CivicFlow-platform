import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "officer-1", userEmail: "officer@example.com" },
      organizationId: "org-a",
      role: "ORG_ADMIN",
      can: (permission: string) =>
        ["imports:read", "imports:create", "imports:review", "imports:resume", "imports:cancel", "imports:resolve-duplicates", "members:write"].includes(
          permission
        ),
    }),
  };
});

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

vi.mock("@/lib/labs/pta/guard", () => ({
  requirePtaVertical: vi.fn().mockResolvedValue({ primaryVertical: "PTA", status: "active" }),
}));
vi.mock("@/lib/hoa/guard", () => ({
  requireHoaCapability: vi.fn().mockResolvedValue({ primaryVertical: "HOA", status: "active" }),
}));

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

  it("SECURITY REGRESSION: rejects IMPORT_NEW on an UPDATE_AVAILABLE row even for a caller who only has imports:review, not imports:resolve-duplicates", async () => {
    // Previously the route only checked whether the submitted decision VALUE
    // required imports:resolve-duplicates, never whether that decision was
    // even legal for the row's actual status. That let an imports:review-only
    // caller submit IMPORT_NEW on a row that had already matched an existing
    // member (UPDATE_AVAILABLE), and executeBatch() would then create a
    // brand-new duplicate OrgMember instead of updating the match — fully
    // bypassing the higher-authority imports:resolve-duplicates gate.
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "READY_FOR_REVIEW" });
    findFirstImportRow.mockResolvedValueOnce({ id: "row-1", status: "UPDATE_AVAILABLE", rowNumber: 2, matchedRecordId: "member-existing" });

    const response = await decidePOST(
      jsonRequest("https://portal.test/api/imports/batch-1/rows/row-1/decide", { decision: "IMPORT_NEW" }),
      { params: Promise.resolve({ id: "batch-1", rowId: "row-1" }) }
    );

    expect(response.status).toBe(400);
    expect(updateImportRow).not.toHaveBeenCalled();
  });

  it("SECURITY REGRESSION: rejects UPDATE_EXISTING on a plain NEW row (no existing match to update)", async () => {
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "READY_FOR_REVIEW" });
    findFirstImportRow.mockResolvedValueOnce({ id: "row-1", status: "NEW", rowNumber: 2, matchedRecordId: null });

    const response = await decidePOST(
      jsonRequest("https://portal.test/api/imports/batch-1/rows/row-1/decide", { decision: "UPDATE_EXISTING" }),
      { params: Promise.resolve({ id: "batch-1", rowId: "row-1" }) }
    );

    expect(response.status).toBe(400);
    expect(updateImportRow).not.toHaveBeenCalled();
  });

  it("still allows UPDATE_EXISTING on an UPDATE_AVAILABLE row for a caller with imports:resolve-duplicates", async () => {
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "READY_FOR_REVIEW" });
    findFirstImportRow.mockResolvedValueOnce({ id: "row-1", status: "UPDATE_AVAILABLE", rowNumber: 2, matchedRecordId: "member-existing" });
    updateImportRow.mockResolvedValueOnce({ id: "row-1", decision: "UPDATE_EXISTING" });

    const response = await decidePOST(
      jsonRequest("https://portal.test/api/imports/batch-1/rows/row-1/decide", { decision: "UPDATE_EXISTING" }),
      { params: Promise.resolve({ id: "batch-1", rowId: "row-1" }) }
    );

    expect(response.status).toBe(200);
  });
});

describe("POST /api/imports/[id]/start", () => {
  it("rejects starting a batch that isn't READY_FOR_REVIEW", async () => {
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "IMPORTING", importKind: "COMMUNITY_MEMBERS" });

    const response = await startPOST(new Request("https://portal.test/api/imports/batch-1/start", { method: "POST" }), {
      params: Promise.resolve({ id: "batch-1" }),
    });

    expect(response.status).toBe(409);
    expect(applyDefaultDecisions).not.toHaveBeenCalled();
  });

  it("applies default decisions, transitions to IMPORTING, and kicks off the first execute tick", async () => {
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "READY_FOR_REVIEW", importKind: "COMMUNITY_MEMBERS" });
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "IMPORTING", importKind: "COMMUNITY_MEMBERS" });

    const response = await startPOST(new Request("https://portal.test/api/imports/batch-1/start", { method: "POST" }), {
      params: Promise.resolve({ id: "batch-1" }),
    });

    expect(response.status).toBe(200);
    expect(applyDefaultDecisions).toHaveBeenCalledWith("batch-1");
    expect(transitionImportBatch).toHaveBeenCalledWith(expect.objectContaining({ to: "IMPORTING" }));
    expect(executeBatch).toHaveBeenCalledWith("batch-1", "org-a", { userId: "officer-1", email: "officer@example.com" });
  });

  it("SECURITY REGRESSION: rejects starting a PTA_HOUSEHOLDS batch for a caller without pta:households:manage, even though they hold imports:create", async () => {
    // Prior to the security-review fix, start/route.ts only checked the
    // generic imports:create permission and never re-verified the batch's
    // actual importKind against the domain-specific permission the way
    // POST /api/imports (creation) already did — meaning a caller who could
    // create-and-review generic import batches but was never granted PTA
    // household access could still trigger real household writes by hitting
    // /start on a PTA_HOUSEHOLDS batch someone else uploaded.
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "READY_FOR_REVIEW", importKind: "PTA_HOUSEHOLDS" });

    const response = await startPOST(new Request("https://portal.test/api/imports/batch-1/start", { method: "POST" }), {
      params: Promise.resolve({ id: "batch-1" }),
    });

    expect(response.status).toBe(403);
    expect(applyDefaultDecisions).not.toHaveBeenCalled();
    expect(executeBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/imports/[id]/resume", () => {
  it("delegates to resumeBatch() with the caller as actor and requestActor", async () => {
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "PAUSED_PLAN_LIMIT", importKind: "COMMUNITY_MEMBERS" });

    const response = await resumePOST(new Request("https://portal.test/api/imports/batch-1/resume", { method: "POST" }), {
      params: Promise.resolve({ id: "batch-1" }),
    });

    expect(response.status).toBe(200);
    expect(resumeBatch).toHaveBeenCalledWith("batch-1", "org-a", "officer-1", { userId: "officer-1", email: "officer@example.com" });
  });

  it("SECURITY REGRESSION: rejects resuming an HOA_PROPERTIES batch for a caller missing hoa:residents:write, even with imports:resume and hoa:properties:write", async () => {
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "PAUSED_PLAN_LIMIT", importKind: "HOA_PROPERTIES" });

    const response = await resumePOST(new Request("https://portal.test/api/imports/batch-1/resume", { method: "POST" }), {
      params: Promise.resolve({ id: "batch-1" }),
    });

    expect(response.status).toBe(403);
    expect(resumeBatch).not.toHaveBeenCalled();
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
