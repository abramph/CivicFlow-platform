import { beforeEach, describe, expect, it, vi } from "vitest";

const consumeToken = vi.fn();
vi.mock("@/lib/auth-tokens", () => ({
  consumeToken: (...args: unknown[]) => consumeToken(...args),
}));

const deleteUserAccount = vi.fn();
vi.mock("@/lib/account-deletion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/account-deletion")>();
  return { ...actual, deleteUserAccount: (...args: unknown[]) => deleteUserAccount(...args) };
});

import { POST } from "@/app/api/account/delete-confirm/route";

function makeRequest(token: string) {
  return new Request("https://portal.test/api/account/delete-confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

describe("POST /api/account/delete-confirm", () => {
  beforeEach(() => {
    consumeToken.mockReset();
    deleteUserAccount.mockReset();
  });

  it("rejects an invalid/expired token without touching the account", async () => {
    consumeToken.mockResolvedValueOnce({ ok: false, error: "This link has expired or was already used." });
    const response = await POST(makeRequest("bad-token"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(deleteUserAccount).not.toHaveBeenCalled();
  });

  it("deletes the account tied to a valid token", async () => {
    consumeToken.mockResolvedValueOnce({ ok: true, userId: "user-1" });
    deleteUserAccount.mockResolvedValueOnce("DELETED");

    const response = await POST(makeRequest("good-token"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(deleteUserAccount).toHaveBeenCalledWith({ userId: "user-1" });
  });

  it("surfaces the sole-ORG_OWNER block instead of deleting", async () => {
    consumeToken.mockResolvedValueOnce({ ok: true, userId: "user-1" });
    const { AccountDeletionError } = await import("@/lib/account-deletion");
    deleteUserAccount.mockRejectedValueOnce(
      new AccountDeletionError("blocked", { code: "SOLE_ORG_OWNER", status: 409, blockedByOrganizations: [{ id: "org-a", name: "Org A" }] })
    );

    const response = await POST(makeRequest("good-token"));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("SOLE_ORG_OWNER");
  });

  it("consumes the account_deletion token type specifically (not password_reset/email_verification)", async () => {
    consumeToken.mockResolvedValueOnce({ ok: true, userId: "user-1" });
    deleteUserAccount.mockResolvedValueOnce("DELETED");
    await POST(makeRequest("good-token"));
    expect(consumeToken).toHaveBeenCalledWith("good-token", "account_deletion");
  });
});
