import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }));
vi.mock("@/lib/authOptions", () => ({ authOptions: {} }));

const bcryptCompare = vi.fn();
vi.mock("bcryptjs", () => ({
  default: { compare: (...args: unknown[]) => bcryptCompare(...args) },
  compare: (...args: unknown[]) => bcryptCompare(...args),
}));

const findUniqueUser = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) } },
}));

const deleteUserAccount = vi.fn();
vi.mock("@/lib/account-deletion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/account-deletion")>();
  return { ...actual, deleteUserAccount: (...args: unknown[]) => deleteUserAccount(...args) };
});

import { POST } from "@/app/api/account/delete/route";

function deleteRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/account/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    bcryptCompare.mockReset();
    findUniqueUser.mockReset();
    deleteUserAccount.mockReset();
  });

  it("rejects an unauthenticated request", async () => {
    getServerSession.mockResolvedValueOnce(null);
    const response = await POST(deleteRequest({ password: "x", confirmText: "DELETE" }));
    expect(response.status).toBe(401);
    expect(deleteUserAccount).not.toHaveBeenCalled();
  });

  it("rejects when the typed confirmation phrase isn't exactly DELETE", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    const response = await POST(deleteRequest({ password: "correct-password", confirmText: "delete pls" }));
    expect(response.status).toBe(400);
    expect(deleteUserAccount).not.toHaveBeenCalled();
  });

  it("rejects an incorrect password without deleting the account", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    findUniqueUser.mockResolvedValueOnce({ passwordHash: "hashed" });
    bcryptCompare.mockResolvedValueOnce(false);

    const response = await POST(deleteRequest({ password: "wrong", confirmText: "DELETE" }));

    expect(response.status).toBe(400);
    expect(deleteUserAccount).not.toHaveBeenCalled();
  });

  it("deletes the account on correct password + confirmation, for the session's own userId only", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    findUniqueUser.mockResolvedValueOnce({ passwordHash: "hashed" });
    bcryptCompare.mockResolvedValueOnce(true);
    deleteUserAccount.mockResolvedValueOnce("DELETED");

    const response = await POST(deleteRequest({ password: "correct-password", confirmText: "delete" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(deleteUserAccount).toHaveBeenCalledWith({ userId: "user-1" });
  });

  it("surfaces the sole-ORG_OWNER block from the service as a 409 with the blocking org list", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    findUniqueUser.mockResolvedValueOnce({ passwordHash: "hashed" });
    bcryptCompare.mockResolvedValueOnce(true);
    const { AccountDeletionError } = await import("@/lib/account-deletion");
    deleteUserAccount.mockRejectedValueOnce(
      new AccountDeletionError("blocked", { code: "SOLE_ORG_OWNER", status: 409, blockedByOrganizations: [{ id: "org-a", name: "Org A" }] })
    );

    const response = await POST(deleteRequest({ password: "correct-password", confirmText: "DELETE" }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("SOLE_ORG_OWNER");
    expect(body.blockedByOrganizations).toEqual([{ id: "org-a", name: "Org A" }]);
  });
});
