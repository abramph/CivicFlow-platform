import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueUser = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
    mfaChallengeToken: { findUnique: vi.fn() },
    // This file predates primaryVertical, which the session callback now
    // also resolves for the active org — stub a stable default so the
    // existing multi-org assertions below are unaffected.
    organization: { findUnique: vi.fn().mockResolvedValue({ primaryVertical: "COMMUNITY" }) },
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

// This file predates PlatformAccess; the session callback now also resolves
// it on every call. Stub it out to a "no platform access" default so the
// existing multi-org assertions below are unaffected — platform-specific
// behavior has its own coverage in authOptions-platform-session.test.ts.
vi.mock("@/lib/platform-access", () => ({
  getPlatformAccessForUser: vi.fn().mockResolvedValue({ hasPlatformAccess: false, platformRoles: [] }),
}));

// Same rationale as the platform-access stub above: this file predates
// impersonation, which the session callback also resolves on every call
// (and which itself reads next/headers' cookies() — unavailable outside a
// real request scope, which is exactly this unit-test environment).
// Impersonation-specific behavior has its own coverage in
// impersonation.test.ts and authOptions-impersonation-session.test.ts.
vi.mock("@/lib/impersonation", () => ({
  resolveImpersonationOverlay: vi.fn().mockResolvedValue(null),
}));

import type { Session } from "next-auth";
import { authOptions } from "@/lib/authOptions";

const sessionCallback = authOptions.callbacks!.session! as unknown as (args: {
  session: Session;
  token: never;
  user: never;
  trigger: undefined;
}) => Promise<Session>;

function emptySession(): Session {
  return {
    org_id: "",
    api_key: "",
    api_base: "",
  } as Session;
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
