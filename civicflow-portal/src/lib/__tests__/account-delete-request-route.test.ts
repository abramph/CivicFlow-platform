import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueUser = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) } },
}));

const createAccountDeletionToken = vi.fn().mockResolvedValue("test-token");
vi.mock("@/lib/auth-tokens", () => ({
  createAccountDeletionToken: (...args: unknown[]) => createAccountDeletionToken(...args),
}));

const sendAccountDeletionEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/mail", () => ({
  sendAccountDeletionEmail: (...args: unknown[]) => sendAccountDeletionEmail(...args),
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { POST } from "@/app/api/account/delete-request/route";

function makeRequest(email: string) {
  return new Request("https://portal.test/api/account/delete-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

describe("POST /api/account/delete-request", () => {
  beforeEach(() => {
    findUniqueUser.mockReset();
    createAccountDeletionToken.mockClear();
    sendAccountDeletionEmail.mockReset();
    sendAccountDeletionEmail.mockResolvedValue(undefined);
  });

  it("returns the identical generic response for an unregistered email -- no account-existence leak", async () => {
    findUniqueUser.mockResolvedValueOnce(null);
    const response = await POST(makeRequest("nobody@example.com"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(createAccountDeletionToken).not.toHaveBeenCalled();
    expect(sendAccountDeletionEmail).not.toHaveBeenCalled();
  });

  it("returns the identical generic response for an already-deleted account -- indistinguishable from unregistered", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", deletedAt: new Date("2026-08-01") });
    const response = await POST(makeRequest("gone@example.com"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(createAccountDeletionToken).not.toHaveBeenCalled();
    expect(sendAccountDeletionEmail).not.toHaveBeenCalled();
  });

  it("creates a token and sends the confirmation email for a registered, active account", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", deletedAt: null });
    const response = await POST(makeRequest("person@example.com"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(createAccountDeletionToken).toHaveBeenCalledWith("user-1");
    expect(sendAccountDeletionEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "person@example.com" })
    );
  });

  it("still returns the generic success response when email delivery throws, instead of a 500", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", deletedAt: null });
    sendAccountDeletionEmail.mockRejectedValueOnce(new Error("SMTP connection refused"));

    const response = await POST(makeRequest("person@example.com"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
