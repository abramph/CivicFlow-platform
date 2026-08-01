import { beforeEach, describe, expect, it, vi } from "vitest";

const userFindUnique = vi.fn();
const userCreate = vi.fn();
const organizationCreate = vi.fn();
const organizationMembershipCreate = vi.fn();
const orgSettingsCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      create: (...args: unknown[]) => userCreate(...args),
    },
    organization: { create: (...args: unknown[]) => organizationCreate(...args) },
    organizationMembership: { create: (...args: unknown[]) => organizationMembershipCreate(...args) },
    orgSettings: { create: (...args: unknown[]) => orgSettingsCreate(...args) },
  },
}));

vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("hashed") } }));
vi.mock("@/lib/auth-tokens", () => ({ createEmailVerificationToken: vi.fn().mockResolvedValue("tok-123") }));
const sendVerificationEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/mail", () => ({ sendVerificationEmail: (...args: unknown[]) => sendVerificationEmail(...args) }));

import { POST } from "@/app/api/auth/signup/route";

function signupRequest(body: unknown) {
  return new Request("https://portal.test/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/signup", () => {
  beforeEach(() => {
    userFindUnique.mockReset();
    userCreate.mockReset();
    organizationCreate.mockReset();
    organizationMembershipCreate.mockReset();
    orgSettingsCreate.mockReset();
    sendVerificationEmail.mockClear();
  });

  it("creates only the personal account — no organization, no membership, no org settings", async () => {
    userFindUnique.mockResolvedValueOnce(null);
    userCreate.mockResolvedValueOnce({ id: "user-1", email: "new@example.com" });

    const response = await POST(
      signupRequest({ email: "new@example.com", password: "password123", displayName: "New User" })
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.ok).toBe(true);
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: "new@example.com", emailVerified: false }) })
    );
    // The core fix this test guards: a brand-new signup must never silently
    // create an Organization (which would default primaryVertical to
    // COMMUNITY without ever asking) — vertical selection now happens
    // exclusively in a separate, later step (/onboarding/organization).
    expect(organizationCreate).not.toHaveBeenCalled();
    expect(organizationMembershipCreate).not.toHaveBeenCalled();
    expect(orgSettingsCreate).not.toHaveBeenCalled();
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "new@example.com" })
    );
  });

  it("rejects a request with no orgName field required — the field no longer exists in the schema", async () => {
    userFindUnique.mockResolvedValueOnce(null);
    userCreate.mockResolvedValueOnce({ id: "user-2", email: "no-org-field@example.com" });

    const response = await POST(
      signupRequest({ email: "no-org-field@example.com", password: "password123" })
    );
    expect(response.status).toBe(201);
  });

  it("rejects signup for an email that already exists", async () => {
    userFindUnique.mockResolvedValueOnce({ id: "existing-user" });

    const response = await POST(signupRequest({ email: "existing@example.com", password: "password123" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 8 characters", async () => {
    const response = await POST(signupRequest({ email: "short@example.com", password: "short" }));
    expect(response.status).toBe(400);
    expect(userCreate).not.toHaveBeenCalled();
  });
});
