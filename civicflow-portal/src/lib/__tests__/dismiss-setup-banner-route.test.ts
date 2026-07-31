import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrganization = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requireOrganization: (...args: unknown[]) => requireOrganization(...args),
  };
});

const setCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ set: setCookie }),
}));

import { POST } from "@/app/api/dashboard/dismiss-setup-banner/route";

describe("POST /api/dashboard/dismiss-setup-banner", () => {
  beforeEach(() => {
    requireOrganization.mockReset();
    setCookie.mockReset();
  });

  it("sets a cookie scoped to the caller's own active organization, never a client-supplied id", async () => {
    requireOrganization.mockResolvedValueOnce({ organizationId: "org-a", role: "ORG_OWNER" });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(setCookie).toHaveBeenCalledWith(
      "cf_setup_dismissed_org-a",
      "1",
      expect.objectContaining({ httpOnly: true, path: "/" })
    );
  });
});
