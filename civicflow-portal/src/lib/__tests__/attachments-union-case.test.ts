import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Regression/security pass (2026-08) finding: verifyAttachmentEntity had no
 * UNION_CASE case and fell through to `default: return false` -- fail-safe
 * (no cross-tenant leak) but a real functionality gap that silently 404'd
 * every Union case attachment upload/read, contradicting
 * docs/union-case-center.md's claim that the entity type was "registered
 * and authorization-gated so the generic attachment API can already accept
 * uploads." This test locks in the fix and would fail again if the case
 * were ever removed.
 */

const findFirstUnionCase = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { unionCase: { findFirst: (...a: unknown[]) => findFirstUnionCase(...a) } },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifyAttachmentEntity — UNION_CASE", () => {
  it("returns true for a case that exists in the caller's own organization", async () => {
    findFirstUnionCase.mockResolvedValueOnce({ id: "case-1" });
    const { verifyAttachmentEntity } = await import("../attachments");

    const result = await verifyAttachmentEntity("org-a", "UNION_CASE", "case-1");

    expect(result).toBe(true);
    expect(findFirstUnionCase).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "case-1", organizationId: "org-a" } }));
  });

  it("returns false for a case that belongs to a different organization -- never falls through to a permissive default", async () => {
    findFirstUnionCase.mockResolvedValueOnce(null);
    const { verifyAttachmentEntity } = await import("../attachments");

    const result = await verifyAttachmentEntity("org-b", "UNION_CASE", "case-in-org-a");

    expect(result).toBe(false);
  });

  it("returns false for an empty entityId without ever querying the database", async () => {
    const { verifyAttachmentEntity } = await import("../attachments");

    const result = await verifyAttachmentEntity("org-a", "UNION_CASE", "");

    expect(result).toBe(false);
    expect(findFirstUnionCase).not.toHaveBeenCalled();
  });
});
