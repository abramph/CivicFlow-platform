import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueUser = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
    mfaChallengeToken: { findUnique: vi.fn() },
  },
}));

const resolveActiveOrganization = vi.fn();
const getUserOrgMemberships = vi.fn();
vi.mock("@/lib/org-context", () => ({
  resolveActiveOrganization: (...args: unknown[]) => resolveActiveOrganization(...args),
  getUserOrgMemberships: (...args: unknown[]) => getUserOrgMemberships(...args),
}));

const getEffectivePermissions = vi.fn();
vi.mock("@/lib/role-permissions", () => ({
  getEffectivePermissions: (...args: unknown[]) => getEffectivePermissions(...args),
}));

import { authOptions } from "@/lib/authOptions";

const sessionCallback = authOptions.callbacks!.session!;

function emptySession() {
  return {
    org_id: "",
    api_key: "",
    api_base: "",
  } as never;
}

describe("authOptions session callback — multi-org resolution", () => {
  beforeEach(() => {
    findUniqueUser.mockReset();
    resolveActiveOrganization.mockReset();
    getUserOrgMemberships.mockReset();
    getEffectivePermissions.mockReset();
    getEffectivePermissions.mockResolvedValue(["members:read"]);
  });

  it("populates organizationId/role/memberId from the resolved active org, and organizations from the full list", async () => {
    findUniqueUser.mockResolvedValueOnce({ email: "user@example.com" });
    resolveActiveOrganization.mockResolvedValueOnce({
      organizationId: "org-b",
      organizationName: "Org B",
      organizationLogoUrl: null,
      role: "ORG_ADMIN",
      memberId: "member-b",
      memberStatus: null,
    });
    const fullList = [
      { organizationId: "org-a", organizationName: "Org A", organizationLogoUrl: null, role: "MEMBER", memberId: "member-a", memberStatus: "active" },
      { organizationId: "org-b", organizationName: "Org B", organizationLogoUrl: null, role: "ORG_ADMIN", memberId: "member-b", memberStatus: null },
    ];
    getUserOrgMemberships.mockResolvedValueOnce(fullList);

    const result = await sessionCallback({
      session: emptySession(),
      token: { userId: "user-1", userEmail: "user@example.com" } as never,
      user: undefined as never,
      trigger: undefined,
    });

    expect(result.organizationId).toBe("org-b");
    expect(result.orgName).toBe("Org B");
    expect(result.role).toBe("ORG_ADMIN");
    expect(result.memberId).toBe("member-b");
    expect(result.organizations).toEqual(fullList);
  });

  it("resolves to null org fields when the user has zero active memberships (e.g. all suspended)", async () => {
    findUniqueUser.mockResolvedValueOnce({ email: "user@example.com" });
    resolveActiveOrganization.mockResolvedValueOnce(null);
    getUserOrgMemberships.mockResolvedValueOnce([]);

    const result = await sessionCallback({
      session: emptySession(),
      token: { userId: "user-1", userEmail: "user@example.com" } as never,
      user: undefined as never,
      trigger: undefined,
    });

    expect(result.organizationId).toBeNull();
    expect(result.role).toBeNull();
    expect(result.memberId).toBeNull();
    expect(result.organizations).toEqual([]);
    // No org/role means no permissions should be looked up.
    expect(getEffectivePermissions).not.toHaveBeenCalled();
  });
});
