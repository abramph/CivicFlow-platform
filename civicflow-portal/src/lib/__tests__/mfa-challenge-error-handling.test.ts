import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }));
vi.mock("@/lib/authOptions", () => ({ authOptions: {} }));

const findUniqueChallengeToken = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    mfaChallengeToken: { findUnique: (...args: unknown[]) => findUniqueChallengeToken(...args) },
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/totp", () => ({ totpVerify: vi.fn() }));
vi.mock("@/lib/sms-otp", () => ({ hashOtpCode: vi.fn() }));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

/**
 * Regression test for the readiness-audit finding: none of the 8 MFA routes
 * were wrapped in withApiErrorHandling, so an unexpected error (e.g. a
 * transient database failure during TOTP verification, on the login
 * critical path) produced an uncaught Next.js 500 instead of a controlled
 * JSON response. This test proves the challenge route now converts an
 * unexpected throw into the same sanitized 500 shape every other route
 * uses -- not a framework error page, no stack trace in the body.
 */
describe("POST /api/auth/mfa/challenge — unexpected errors are now handled, not uncaught", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a controlled JSON 500 (via withApiErrorHandling) when the database throws mid-request, instead of an uncaught crash", async () => {
    getServerSession.mockResolvedValueOnce({ mfaPending: true, mfaUserId: "user-1", mfaTokenId: "token-1" });
    findUniqueChallengeToken.mockRejectedValueOnce(new Error("database unavailable"));

    const { POST } = await import("@/app/api/auth/mfa/challenge/route");
    const request = new Request("https://portal.test/api/auth/mfa/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "123456" }),
    });

    // Must not throw out of POST() itself -- that's exactly the pre-fix bug
    // (an unhandled rejection/uncaught error crashing the request instead
    // of a structured response).
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(typeof body.error).toBe("string");
  });

  it("in production, the error message is fully sanitized (no internal detail leakage)", async () => {
    const originalEnv = process.env.NODE_ENV;
    // @ts-expect-error -- NODE_ENV is readonly in the type, but this is the
    // standard pattern for exercising the prod-only branch under test.
    process.env.NODE_ENV = "production";
    try {
      getServerSession.mockResolvedValueOnce({ mfaPending: true, mfaUserId: "user-1", mfaTokenId: "token-1" });
      findUniqueChallengeToken.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"));

      const { POST } = await import("@/app/api/auth/mfa/challenge/route");
      const request = new Request("https://portal.test/api/auth/mfa/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "123456" }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("Internal server error");
      expect(JSON.stringify(body)).not.toContain("hunter2");
      expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    } finally {
      // @ts-expect-error -- restoring the same readonly-typed property
      process.env.NODE_ENV = originalEnv;
    }
  });
});
