import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "officer-1", userEmail: "officer@example.com" },
      organizationId: "org-a",
      role: "STAFF",
      can: (permission: string) => ["imports:review"].includes(permission),
    }),
  };
});

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const findFirstImportBatch = vi.fn();
const updateManyImportRow = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    importBatch: { findFirst: (...args: unknown[]) => findFirstImportBatch(...args) },
    importRow: { updateMany: (...args: unknown[]) => updateManyImportRow(...args) },
  },
}));

import { POST as skipExactDuplicatesPOST } from "@/app/api/imports/[id]/skip-exact-duplicates/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/imports/[id]/skip-exact-duplicates", () => {
  it("rejects when the batch isn't READY_FOR_REVIEW", async () => {
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "IMPORTING" });

    const response = await skipExactDuplicatesPOST(new Request("https://portal.test/api/imports/batch-1/skip-exact-duplicates", { method: "POST" }), {
      params: Promise.resolve({ id: "batch-1" }),
    });

    expect(response.status).toBe(409);
    expect(updateManyImportRow).not.toHaveBeenCalled();
  });

  it("only touches EXACT_DUPLICATE rows in this batch, setting decision to SKIP, and works for a caller with only imports:review", async () => {
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", status: "READY_FOR_REVIEW" });
    updateManyImportRow.mockResolvedValueOnce({ count: 7 });

    const response = await skipExactDuplicatesPOST(new Request("https://portal.test/api/imports/batch-1/skip-exact-duplicates", { method: "POST" }), {
      params: Promise.resolve({ id: "batch-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.skippedCount).toBe(7);
    expect(updateManyImportRow).toHaveBeenCalledWith({
      where: { batchId: "batch-1", organizationId: "org-a", status: "EXACT_DUPLICATE" },
      data: { decision: "SKIP", decidedByUserId: "officer-1", decidedAt: expect.any(Date) },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "import_row.bulk_skip_exact_duplicates", metadata: { count: 7 } }));
  });
});
