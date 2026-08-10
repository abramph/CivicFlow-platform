import { beforeEach, describe, expect, it, vi } from "vitest";

const acceptPtaHouseholdAdultInvite = vi.fn();
vi.mock("@/lib/labs/pta/accept-household-adult-invite", () => ({
  acceptPtaHouseholdAdultInvite: (...args: unknown[]) => acceptPtaHouseholdAdultInvite(...args),
}));
vi.mock("@/lib/rate-limit", () => ({
  requireRateLimit: vi.fn().mockResolvedValue(null),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
const signMobileTokenPair = vi.fn().mockResolvedValue({ accessToken: "at", refreshToken: "rt", expiresIn: 900 });
vi.mock("@/lib/mobile-auth", () => ({ signMobileTokenPair: (...args: unknown[]) => signMobileTokenPair(...args) }));

import { POST as webAccept } from "@/app/api/auth/accept-pta-household-invite/route";
import { POST as mobileAccept } from "@/app/api/mobile/auth/accept-pta-household-invite/route";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("accept-pta-household-invite routes", () => {
  beforeEach(() => {
    acceptPtaHouseholdAdultInvite.mockReset();
  });

  it("web route returns the user on success, without any mobile token pair", async () => {
    acceptPtaHouseholdAdultInvite.mockResolvedValueOnce({
      ok: true,
      user: { id: "user-1", email: "parent@example.com", displayName: "Parent One" },
      mobileTokenVersion: 0,
    });

    const response = await webAccept(jsonRequest("https://portal.test/api/auth/accept-pta-household-invite", { token: "tok", password: "a-strong-password" }));
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(body.data.user.email).toBe("parent@example.com");
    expect(body.data.accessToken).toBeUndefined();
  });

  it("web route surfaces the underlying error message on failure", async () => {
    acceptPtaHouseholdAdultInvite.mockResolvedValueOnce({ ok: false, error: "This invite has already been used." });

    const response = await webAccept(jsonRequest("https://portal.test/api/auth/accept-pta-household-invite", { token: "tok", password: "a-strong-password" }));
    const body = await response.json();

    expect(response.ok).toBe(false);
    expect(body.error).toContain("already been used");
  });

  it("mobile route signs a token pair on success", async () => {
    acceptPtaHouseholdAdultInvite.mockResolvedValueOnce({
      ok: true,
      user: { id: "user-1", email: "parent@example.com", displayName: "Parent One" },
      mobileTokenVersion: 0,
    });

    const response = await mobileAccept(jsonRequest("https://portal.test/api/mobile/auth/accept-pta-household-invite", { token: "tok", password: "a-strong-password" }));
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(body.data.accessToken).toBe("at");
    expect(signMobileTokenPair).toHaveBeenCalledWith("user-1", 0);
  });
});
