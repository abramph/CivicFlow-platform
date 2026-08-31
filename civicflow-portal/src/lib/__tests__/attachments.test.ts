import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * fix/pta-treasurer-financial-controls §7 — reimbursement receipts are the
 * one attachment surface with an ownership boundary narrower than "any
 * user holding the base entity permission." verifyAttachmentOwnership()
 * carries that check; isAllowedAttachmentContentType() carries the
 * REIMBURSEMENT-only MIME allowlist. Both are additive — every other
 * entity type's pre-existing, unrestricted contract must be unchanged.
 */

const findFirstReimbursement = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { reimbursementRequest: { findFirst: (...a: unknown[]) => findFirstReimbursement(...a) } },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifyAttachmentOwnership", () => {
  it("every non-REIMBURSEMENT entity type returns true immediately, without querying the database", async () => {
    const { verifyAttachmentOwnership, attachmentEntityTypes } = await import("../attachments");
    for (const entityType of attachmentEntityTypes.filter((type) => type !== "REIMBURSEMENT")) {
      const result = await verifyAttachmentOwnership("org-1", entityType, "entity-1", { userId: "u1", canManage: false });
      expect(result).toBe(true);
    }
    expect(findFirstReimbursement).not.toHaveBeenCalled();
  });

  it("a manager (reimbursements:manage) may access any reimbursement in the org without a lookup", async () => {
    const { verifyAttachmentOwnership } = await import("../attachments");
    const result = await verifyAttachmentOwnership("org-1", "REIMBURSEMENT", "req-1", { userId: "manager-1", canManage: true });
    expect(result).toBe(true);
    expect(findFirstReimbursement).not.toHaveBeenCalled();
  });

  it("a non-manager may access only their own submission", async () => {
    findFirstReimbursement.mockResolvedValueOnce({ submittedByUserId: "chair-1" });
    const { verifyAttachmentOwnership } = await import("../attachments");
    const result = await verifyAttachmentOwnership("org-1", "REIMBURSEMENT", "req-1", { userId: "chair-1", canManage: false });
    expect(result).toBe(true);
    expect(findFirstReimbursement.mock.calls[0][0].where).toMatchObject({ id: "req-1", organizationId: "org-1" });
  });

  it("a non-manager cannot access another user's submission, even by guessing its id", async () => {
    findFirstReimbursement.mockResolvedValueOnce({ submittedByUserId: "someone-else" });
    const { verifyAttachmentOwnership } = await import("../attachments");
    const result = await verifyAttachmentOwnership("org-1", "REIMBURSEMENT", "req-1", { userId: "chair-1", canManage: false });
    expect(result).toBe(false);
  });

  it("fails closed when the reimbursement doesn't exist in this organization (cross-org)", async () => {
    findFirstReimbursement.mockResolvedValueOnce(null);
    const { verifyAttachmentOwnership } = await import("../attachments");
    const result = await verifyAttachmentOwnership("org-b", "REIMBURSEMENT", "req-in-org-a", { userId: "chair-1", canManage: false });
    expect(result).toBe(false);
  });
});

describe("isAllowedAttachmentContentType", () => {
  it("REIMBURSEMENT accepts PDF/JPEG/PNG/HEIC/HEIF only", async () => {
    const { isAllowedAttachmentContentType } = await import("../attachments");
    for (const type of ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif"]) {
      expect(isAllowedAttachmentContentType("REIMBURSEMENT", type)).toBe(true);
    }
  });

  it("REIMBURSEMENT blocks executables, HTML, scripts, and arbitrary MIME types", async () => {
    const { isAllowedAttachmentContentType } = await import("../attachments");
    for (const type of ["application/x-msdownload", "text/html", "application/javascript", "application/octet-stream", "text/plain"]) {
      expect(isAllowedAttachmentContentType("REIMBURSEMENT", type)).toBe(false);
    }
  });

  it("every other entity type keeps its unrestricted contract (no entry = no restriction)", async () => {
    const { isAllowedAttachmentContentType, attachmentEntityTypes } = await import("../attachments");
    for (const entityType of attachmentEntityTypes.filter((type) => type !== "REIMBURSEMENT")) {
      expect(isAllowedAttachmentContentType(entityType, "application/x-msdownload")).toBe(true);
    }
  });
});
