import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requireAuth: vi.fn(async () => ({ userId: "user-1", userEmail: "user@example.com" })),
  };
});

const getUserOrgMemberships = vi.fn();
vi.mock("@/lib/org-context", () => ({
  ACTIVE_ORG_COOKIE: "cf_active_org",
  getUserOrgMemberships: (...args: unknown[]) => getUserOrgMemberships(...args),
}));

const setCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ set: setCookie }),
}));

import { POST } from "@/app/api/organization/select/route";

function jsonRequest(body: unknown) {
  return new Request("https://portal.test/api/organization/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/organization/select", () => {
  beforeEach(() => {
    getUserOrgMemberships.mockReset();
    setCookie.mockClear();
  });

  it("rejects an organizationId the user doesn't belong to", async () => {
    getUserOrgMemberships.mockResolvedValueOnce([
      { organizationId: "org-a", role: "STAFF", memberId: null },
    ]);

    const response = await POST(jsonRequest({ organizationId: "org-b" }));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("sets the unified cookie and returns the role/memberId for a valid organization", async () => {
    getUserOrgMemberships.mockResolvedValueOnce([
      { organizationId: "org-a", role: "STAFF", memberId: null },
      { organizationId: "org-b", role: "MEMBER", memberId: "member-1" },
    ]);

    const response = await POST(jsonRequest({ organizationId: "org-b" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ ok: true, role: "MEMBER", memberId: "member-1" });
    expect(setCookie).toHaveBeenCalledWith(
      "cf_active_org",
      "org-b",
      expect.objectContaining({ httpOnly: true, sameSite: "lax" })
    );
  });
});
