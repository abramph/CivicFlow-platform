import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueUser = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUniqueUser(...args),
    },
  },
}));

const createPasswordResetToken = vi.fn().mockResolvedValue("test-token");
vi.mock("@/lib/auth-tokens", () => ({
  createPasswordResetToken: (...args: unknown[]) => createPasswordResetToken(...args),
}));

const sendPasswordResetEmail = vi.fn().mockResolvedValue({ sent: true, skipped: false });
vi.mock("@/lib/mail", () => ({
  sendPasswordResetEmail: (...args: unknown[]) => sendPasswordResetEmail(...args),
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { POST } from "@/app/api/auth/forgot-password/route";

function makeRequest(email: string) {
  return new Request("https://portal.test/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    findUniqueUser.mockReset();
    createPasswordResetToken.mockClear();
    sendPasswordResetEmail.mockReset();
    sendPasswordResetEmail.mockResolvedValue({ sent: true, skipped: false });
  });

  it("returns the generic success response for an unregistered email, without creating a token", async () => {
    findUniqueUser.mockResolvedValueOnce(null);
    const response = await POST(makeRequest("nobody@example.com"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(createPasswordResetToken).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("creates a token and sends the reset email for a registered user", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "person@example.com" });
    const response = await POST(makeRequest("person@example.com"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(createPasswordResetToken).toHaveBeenCalledWith("user-1");
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "person@example.com" })
    );
  });

  it("still returns the generic success response when email delivery throws, instead of a 500", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "person@example.com" });
    sendPasswordResetEmail.mockRejectedValueOnce(new Error("SMTP connection refused"));

    const response = await POST(makeRequest("person@example.com"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("returns an independently readable body on repeated calls (no shared/consumed Response reuse)", async () => {
    findUniqueUser.mockResolvedValue(null);

    const first = await POST(makeRequest("nobody@example.com"));
    const second = await POST(makeRequest("nobody@example.com"));

    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(firstBody.ok).toBe(true);
    expect(secondBody.ok).toBe(true);
  });
});
