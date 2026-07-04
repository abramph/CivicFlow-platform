import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstMembership = vi.fn();
const findFirstOrgMember = vi.fn();
const findUniqueUser = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationMembership: { findFirst: (...args: unknown[]) => findFirstMembership(...args) },
    orgMember: { findFirst: (...args: unknown[]) => findFirstOrgMember(...args) },
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
  },
}));

import { requireMobileAuth, requireMobileMembership, signAccessToken } from "@/lib/mobile-auth";

function requestWithToken(token: string) {
  return new Request("https://portal.test/api/mobile/dues", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("mobile-auth: token round trip", () => {
  it("signs and verifies an access token for the same user", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "member@example.com" });
    const token = await signAccessToken("user-1");
    const session = await requireMobileAuth(requestWithToken(token));
    expect(session).toEqual({ userId: "user-1", email: "member@example.com" });
  });

  it("rejects a request with no bearer token", async () => {
    await expect(requireMobileAuth(new Request("https://portal.test/api/mobile/dues"))).rejects.toThrow(
      /Missing bearer token/
    );
  });

  it("rejects a token whose user no longer exists", async () => {
    findUniqueUser.mockResolvedValueOnce(null);
    const token = await signAccessToken("deleted-user");
    await expect(requireMobileAuth(requestWithToken(token))).rejects.toThrow(/no longer exists/);
  });
});

describe("mobile-auth: cross-organization tenant isolation", () => {
  beforeEach(() => {
    findFirstMembership.mockReset();
    findFirstOrgMember.mockReset();
    findUniqueUser.mockReset();
  });

  it("grants access when the caller has a MEMBER membership in the requested org", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "member@example.com" });
    findFirstMembership.mockResolvedValueOnce({ id: "membership-1", organizationId: "org-a", userId: "user-1", role: "MEMBER" });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1" });

    const token = await signAccessToken("user-1");
    const result = await requireMobileMembership(requestWithToken(token), "org-a");

    expect(result.organizationId).toBe("org-a");
    expect(result.memberId).toBe("member-1");
    expect(findFirstMembership).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-a", userId: "user-1", role: "MEMBER" }) })
    );
  });

  it("denies access to an organization the caller does not belong to — even though they're authenticated", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "member@example.com" });
    // Caller only has a membership in org-a; they ask for org-b's data.
    findFirstMembership.mockResolvedValueOnce(null);

    const token = await signAccessToken("user-1");
    await expect(requireMobileMembership(requestWithToken(token), "org-b")).rejects.toThrow(
      /No active membership for this organization/
    );
    expect(findFirstOrgMember).not.toHaveBeenCalled();
  });

  it("denies access when a membership exists but has no linked OrgMember record", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "member@example.com" });
    findFirstMembership.mockResolvedValueOnce({ id: "membership-1", organizationId: "org-a", userId: "user-1", role: "MEMBER" });
    findFirstOrgMember.mockResolvedValueOnce(null);

    const token = await signAccessToken("user-1");
    await expect(requireMobileMembership(requestWithToken(token), "org-a")).rejects.toThrow(
      /No linked member record/
    );
  });
});
