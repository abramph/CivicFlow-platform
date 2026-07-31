import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueUser = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
    mfaChallengeToken: { findUnique: vi.fn() },
    // This file predates primaryVertical, which the session callback now
    // also resolves for the active org — stub a stable default so the
    // existing impersonation-overlay assertions below are unaffected.
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
vi.mock("@/lib/platform-access", () => ({
  getPlatformAccessForUser: (...args: unknown[]) => getPlatformAccessForUser(...args),
}));

const resolveImpersonationOverlay = vi.fn();
vi.mock("@/lib/impersonation", () => ({
  resolveImpersonationOverlay: (...args: unknown[]) => resolveImpersonationOverlay(...args),
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

beforeEach(() => {
  findUniqueUser.mockReset();
  resolveActiveOrganization.mockReset();
  getUserOrgMemberships.mockReset();
  getEffectivePermissions.mockReset();
  getPlatformAccessForUser.mockReset();
  resolveImpersonationOverlay.mockReset();
});

describe("authOptions session callback — impersonation overlay", () => {
  it("with no active overlay, resolves identity from the REAL token.userId exactly as before (regression guard)", async () => {
    resolveImpersonationOverlay.mockResolvedValueOnce(null);
    findUniqueUser.mockResolvedValueOnce({ email: "admin@unestra.example" });
    resolveActiveOrganization.mockResolvedValueOnce({ organizationId: "org-a", organizationName: "Org A", role: "STAFF", memberId: null });
    getUserOrgMemberships.mockResolvedValueOnce([]);
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] });
    getEffectivePermissions.mockResolvedValueOnce(["members:read"]);

    const result = await sessionCallback({
      session: emptySession(),
      token: { userId: "admin-1", userEmail: "admin@unestra.example" } as never,
      user: undefined as never,
      trigger: undefined,
    });

    expect(result.userId).toBe("admin-1");
    expect(result.hasPlatformAccess).toBe(true);
    expect(result.impersonation).toBeUndefined();
    expect(resolveImpersonationOverlay).toHaveBeenCalledWith("admin-1");
  });

  it("with a valid overlay, resolves EVERY identity field from the target user, not the real admin — and never leaks the admin's own platform access into the impersonated view", async () => {
    resolveImpersonationOverlay.mockResolvedValueOnce({
      actorUserId: "admin-1",
      actorEmail: "admin@unestra.example",
      actorDisplayName: "Admin Person",
      targetUserId: "target-1",
      targetDisplayName: "Sarah Mitchell",
      targetEmail: "sarah@pinegrovepta.example",
      organizationId: "org-a",
      organizationName: "Pine Grove School PTA",
      startedAt: "2026-07-23T00:00:00.000Z",
      reason: "demo",
    });
    findUniqueUser.mockResolvedValueOnce({ email: "sarah@pinegrovepta.example" });
    resolveActiveOrganization.mockResolvedValueOnce({
      organizationId: "org-a",
      organizationName: "Pine Grove School PTA",
      role: "ORG_OWNER",
      memberId: "member-sarah",
    });
    getUserOrgMemberships.mockResolvedValueOnce([
      { organizationId: "org-a", organizationName: "Pine Grove School PTA", role: "ORG_OWNER", memberId: "member-sarah" },
    ]);
    // The target is an ordinary PTA president — never a platform admin.
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: false, platformRoles: [] });
    getEffectivePermissions.mockResolvedValueOnce(["pta:directory:read", "pta:households:manage"]);

    const result = await sessionCallback({
      session: emptySession(),
      token: { userId: "admin-1", userEmail: "admin@unestra.example" } as never,
      user: undefined as never,
      trigger: undefined,
    });

    // Every downstream-consumed identity field reflects the TARGET.
    expect(result.userId).toBe("target-1");
    expect(result.userEmail).toBe("sarah@pinegrovepta.example");
    expect(result.organizationId).toBe("org-a");
    expect(result.role).toBe("ORG_OWNER");
    expect(result.memberId).toBe("member-sarah");
    expect(result.permissions).toEqual(["pta:directory:read", "pta:households:manage"]);
    // No platform-admin ability leaks into the impersonated session.
    expect(result.hasPlatformAccess).toBe(false);
    expect(result.platformRoles).toEqual([]);
    // resolveActiveOrganization/getEffectivePermissions were called for the
    // TARGET, not the real admin — this is what makes the overlay total,
    // not just a display-layer relabeling.
    expect(resolveActiveOrganization).toHaveBeenCalledWith("target-1");
    expect(getPlatformAccessForUser).toHaveBeenCalledWith("target-1");
    expect(getEffectivePermissions).toHaveBeenCalledWith("org-a", "ORG_OWNER");

    // The banner metadata identifies the REAL admin as actor, target as target.
    expect(result.impersonation).toMatchObject({
      active: true,
      actorUserId: "admin-1",
      actorEmail: "admin@unestra.example",
      targetUserId: "target-1",
      targetDisplayName: "Sarah Mitchell",
      organizationName: "Pine Grove School PTA",
    });
  });

  it("always calls resolveImpersonationOverlay with the REAL token.userId, never a value derived from anything client-controlled", async () => {
    resolveImpersonationOverlay.mockResolvedValueOnce(null);
    findUniqueUser.mockResolvedValueOnce({ email: "user@example.com" });
    resolveActiveOrganization.mockResolvedValueOnce(null);
    getUserOrgMemberships.mockResolvedValueOnce([]);
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: false, platformRoles: [] });

    await sessionCallback({
      session: emptySession(),
      token: { userId: "real-user-42", userEmail: "user@example.com" } as never,
      user: undefined as never,
      trigger: undefined,
    });

    expect(resolveImpersonationOverlay).toHaveBeenCalledWith("real-user-42");
  });
});
