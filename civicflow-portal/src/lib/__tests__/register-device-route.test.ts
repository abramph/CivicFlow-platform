import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertMobileDeviceToken = vi.fn().mockResolvedValue({ id: "token-row-1" });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mobileDeviceToken: { upsert: (...args: unknown[]) => upsertMobileDeviceToken(...args) },
  },
}));

vi.mock("@/lib/mobile-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mobile-auth")>();
  return {
    ...actual,
    requireMobileAuth: vi.fn().mockResolvedValue({ userId: "user-1", email: "member@example.com" }),
  };
});

vi.mock("@/lib/rate-limit", () => ({
  requireRateLimit: vi.fn().mockResolvedValue(null),
}));

import { POST } from "@/app/api/mobile/register-device/route";

function jsonRequest(body: unknown) {
  return new Request("https://portal.test/api/mobile/register-device", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/register-device", () => {
  beforeEach(() => {
    upsertMobileDeviceToken.mockClear();
  });

  it("upserts on the caller's own userId, scoped by [userId, token]", async () => {
    const response = await POST(
      jsonRequest({ platform: "ios", token: "ExponentPushToken[abc]", deviceName: "iPhone", organizationId: "org-a" })
    );
    expect(response.status).toBe(200);

    expect(upsertMobileDeviceToken).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_token: { userId: "user-1", token: "ExponentPushToken[abc]" } },
        create: expect.objectContaining({ userId: "user-1", token: "ExponentPushToken[abc]", platform: "ios" }),
      })
    );
  });

  it("rejects an invalid platform value", async () => {
    const response = await POST(jsonRequest({ platform: "windows-phone", token: "abc" }));
    expect(response.status).toBe(400);
    expect(upsertMobileDeviceToken).not.toHaveBeenCalled();
  });

  it("rejects a missing token", async () => {
    const response = await POST(jsonRequest({ platform: "ios" }));
    expect(response.status).toBe(400);
  });
});
