import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyAttachment = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { attachment: { findMany: (...a: unknown[]) => findManyAttachment(...a) } },
}));

beforeEach(() => vi.clearAllMocks());

describe("listApprovedPtaMinutes — approved-only, tenant-scoped", () => {
  it("queries only entityType MEETING with purpose 'approved_minutes' — a draft or any other attachment purpose is never included by this query shape", async () => {
    findManyAttachment.mockResolvedValueOnce([]);
    const { listApprovedPtaMinutes } = await import("../minutes");
    await listApprovedPtaMinutes("org-a");

    expect(findManyAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", entityType: "MEETING", purpose: "approved_minutes", deletedAt: null } })
    );
  });

  it("is scoped to the calling organization only", async () => {
    findManyAttachment.mockResolvedValueOnce([{ id: "att-1" }]);
    const { listApprovedPtaMinutes } = await import("../minutes");
    const result = await listApprovedPtaMinutes("org-b");
    expect(result).toEqual([{ id: "att-1" }]);
    const callArgs = findManyAttachment.mock.calls[0][0];
    expect(callArgs.where.organizationId).toBe("org-b");
  });
});
