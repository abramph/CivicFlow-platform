import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteManyDeviceToken = vi.fn().mockResolvedValue({ count: 0 });
const updateUser = vi.fn().mockResolvedValue({ id: "user-1" });
const consumeToken = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mobileDeviceToken: { deleteMany: (...args: unknown[]) => deleteManyDeviceToken(...args) },
    user: { update: (...args: unknown[]) => updateUser(...args) },
  },
}));

vi.mock("@/lib/mobile-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mobile-auth")>();
  return {
    ...actual,
    requireMobileAuth: vi.fn().mockResolvedValue({ userId: "user-1", email: "member@example.com" }),
  };
});

vi.mock("@/lib/auth-tokens", () => ({
  consumeToken: (...args: unknown[]) => consumeToken(...args),
}));

import { POST as logoutPOST } from "@/app/api/mobile/auth/logout/route";
import { POST as resetPasswordPOST } from "@/app/api/auth/reset-password/route";

describe("POST /api/mobile/auth/logout", () => {
  beforeEach(() => {
    deleteManyDeviceToken.mockClear();
    updateUser.mockClear();
  });

  it("bumps mobileTokenVersion, revoking every outstanding token for the account", async () => {
    const response = await logoutPOST(
      new Request("https://portal.test/api/mobile/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );

    expect(response.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { mobileTokenVersion: { increment: 1 } },
    });
  });
});

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    updateUser.mockClear();
    consumeToken.mockReset();
    consumeToken.mockResolvedValue({ ok: true, userId: "user-1" });
  });

  it("bumps mobileTokenVersion alongside the password change", async () => {
    const response = await resetPasswordPOST(
      new Request("https://portal.test/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "reset-token", password: "a-new-strong-password" }),
      })
    );

    expect(response.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({ mobileTokenVersion: { increment: 1 } }),
      })
    );
  });
});
