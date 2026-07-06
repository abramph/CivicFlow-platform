import { beforeEach, describe, expect, it, vi } from "vitest";

const getMemberWebSession = vi.fn();
vi.mock("@/lib/member-web-session", () => ({
  getMemberWebSession: (...args: unknown[]) => getMemberWebSession(...args),
  MEMBER_ORG_COOKIE: "cf_member_org",
}));

const setCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ set: setCookie }),
}));

import { POST } from "@/app/api/member-portal/select-organization/route";

function jsonRequest(body: unknown) {
  return new Request("https://portal.test/api/member-portal/select-organization", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/member-portal/select-organization", () => {
  beforeEach(() => {
    getMemberWebSession.mockReset();
    setCookie.mockClear();
  });

  it("rejects an organizationId the member doesn't actually belong to", async () => {
    // getMemberWebSession falls back to a different org when the requested one is invalid.
    getMemberWebSession.mockResolvedValueOnce({ organizationId: "org-a" });

    const response = await POST(jsonRequest({ organizationId: "org-b" }));

    expect(response.status).toBe(403);
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("sets the persistent org cookie when the member does belong to it", async () => {
    getMemberWebSession.mockResolvedValueOnce({ organizationId: "org-a" });

    const response = await POST(jsonRequest({ organizationId: "org-a" }));

    expect(response.status).toBe(200);
    expect(setCookie).toHaveBeenCalledWith(
      "cf_member_org",
      "org-a",
      expect.objectContaining({ httpOnly: true, sameSite: "lax" })
    );
  });
});
