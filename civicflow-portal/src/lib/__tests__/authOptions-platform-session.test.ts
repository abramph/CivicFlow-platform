import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueUser = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
    mfaChallengeToken: { findUnique: vi.fn() },
    // This file predates primaryVertical, which the session callback now
    // also resolves for the active org — stub a stable default so the
    // existing platform-access assertions below are unaffected.
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

const getPlatformAccessForUser = vi.fn();
vi.mock("@/lib/platform-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/platform-access")>("@/lib/platform-access");
  return { ...actual, getPlatformAccessForUser: (...args: unknown[]) => getPlatformAccessForUser(...args) };
});

// This file predates impersonation, which the session callback also
// resolves on every call (and which itself reads next/headers' cookies() —
// unavailable outside a real request scope, which is exactly this unit-test
// environment). Impersonation-specific behavior has its own coverage in
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
  return { org_id: "", api_key: "", api_base: "" } as Session;
}

describe("authOptions session callback — platform access is independent of active organization", () => {
  beforeEach(() => {
    findUniqueUser.mockReset();
    resolveActiveOrganization.mockReset();
    getUserOrgMemberships.mockReset();
    getEffectivePermissions.mockReset();
    getEffectivePermissions.mockResolvedValue([]);
    getPlatformAccessForUser.mockReset();
  });

  it("populates hasPlatformAccess/platformRoles from PlatformAccess even when the active org is null", async () => {
    findUniqueUser.mockResolvedValueOnce({ email: "admin@example.com" });
    resolveActiveOrganization.mockResolvedValueOnce(null);
    getUserOrgMemberships.mockResolvedValueOnce([]);
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] });

    const result = await sessionCallback({
      session: emptySession(),
      token: { userId: "user-1", userEmail: "admin@example.com" } as never,
      user: undefined as never,
      trigger: undefined,
    });

    expect(result.organizationId).toBeNull();
    expect(result.hasPlatformAccess).toBe(true);
    expect(result.platformRoles).toEqual(["SUPER_ADMIN"]);
  });

  it("keeps hasPlatformAccess true when the active org changes (independent axes)", async () => {
    findUniqueUser.mockResolvedValue({ email: "admin@example.com" });
    getPlatformAccessForUser.mockResolvedValue({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] });

    resolveActiveOrganization.mockResolvedValueOnce({
      organizationId: "org-aph", organizationName: "APH Technologies, LLC", organizationLogoUrl: null, role: "SUPER_ADMIN", memberId: null, memberStatus: null,
    });
    getUserOrgMemberships.mockResolvedValueOnce([]);
    const first = await sessionCallback({
      session: emptySession(),
      token: { userId: "user-1", userEmail: "admin@example.com" } as never,
      user: undefined as never,
      trigger: undefined,
    });

    resolveActiveOrganization.mockResolvedValueOnce({
      organizationId: "org-thrivepathmhs", organizationName: "Thrivepathmhs", organizationLogoUrl: null, role: "ORG_OWNER", memberId: null, memberStatus: null,
    });
    getUserOrgMemberships.mockResolvedValueOnce([]);
    const second = await sessionCallback({
      session: emptySession(),
      token: { userId: "user-1", userEmail: "admin@example.com" } as never,
      user: undefined as never,
      trigger: undefined,
    });

    expect(first.organizationId).toBe("org-aph");
    expect(first.role).toBe("SUPER_ADMIN");
    expect(second.organizationId).toBe("org-thrivepathmhs");
    expect(second.role).toBe("ORG_OWNER");
    // Platform access is unaffected by which org is active in either case.
    expect(first.hasPlatformAccess).toBe(true);
    expect(second.hasPlatformAccess).toBe(true);
  });

  it("returns hasPlatformAccess: false for an ordinary org member with no PlatformAccess row", async () => {
    findUniqueUser.mockResolvedValueOnce({ email: "member@example.com" });
    resolveActiveOrganization.mockResolvedValueOnce({
      organizationId: "org-thrivepathmhs", organizationName: "Thrivepathmhs", organizationLogoUrl: null, role: "ORG_OWNER", memberId: null, memberStatus: null,
    });
    getUserOrgMemberships.mockResolvedValueOnce([]);
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: false, platformRoles: [] });

    const result = await sessionCallback({
      session: emptySession(),
      token: { userId: "user-2", userEmail: "member@example.com" } as never,
      user: undefined as never,
      trigger: undefined,
    });

    expect(result.role).toBe("ORG_OWNER");
    expect(result.hasPlatformAccess).toBe(false);
    expect(result.platformRoles).toEqual([]);
  });

  it("does not expose the raw PlatformAccess record — only the derived hasPlatformAccess/platformRoles fields", async () => {
    findUniqueUser.mockResolvedValueOnce({ email: "admin@example.com" });
    resolveActiveOrganization.mockResolvedValueOnce(null);
    getUserOrgMemberships.mockResolvedValueOnce([]);
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] });

    const result = await sessionCallback({
      session: emptySession(),
      token: { userId: "user-1", userEmail: "admin@example.com" } as never,
      user: undefined as never,
      trigger: undefined,
    });

    const keys = Object.keys(result);
    expect(keys).not.toContain("platformAccess");
    expect(keys).not.toContain("grantedById");
    expect(keys).not.toContain("revokedById");
  });

  it("sets hasPlatformAccess: false and platformRoles: [] on the legacy/no-userId session branch", async () => {
    const result = await sessionCallback({
      session: emptySession(),
      // No token.userId — the legacy org-api-key branch.
      token: { org_id: "legacy-org", api_key: "key" } as never,
      user: undefined as never,
      trigger: undefined,
    });

    expect(result.hasPlatformAccess).toBe(false);
    expect(result.platformRoles).toEqual([]);
    expect(getPlatformAccessForUser).not.toHaveBeenCalled();
  });
});
