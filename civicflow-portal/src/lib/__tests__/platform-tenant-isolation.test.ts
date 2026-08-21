import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }));

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (...args: [string]) => redirect(...args) }));

const getEffectivePermissions = vi.fn();
vi.mock("@/lib/role-permissions", () => ({
  getEffectivePermissions: (...args: unknown[]) => getEffectivePermissions(...args),
}));

vi.mock("@/lib/authOptions", () => ({ authOptions: {} }));

// This suite tests platform-access/tenant-isolation logic. assertOrganizationAccess
// is a plain vi.fn() (not a fixed mockResolvedValue) so the E2E-2 "platform
// support context" tests below can assert it was never called at all — the
// platform-administration path must be architecturally independent of the
// per-organization billing gate, not merely permitted through it.
const assertOrganizationAccess = vi.fn().mockResolvedValue({
  allowed: true,
  reason: null,
  trialEndsAt: null,
  subscriptionStatus: null,
  billingExempt: false,
});
vi.mock("@/lib/subscription-gate", () => ({
  assertOrganizationAccess: (...args: unknown[]) => assertOrganizationAccess(...args),
}));

const getPlatformAccessForUser = vi.fn();
const hasPlatformRole = vi.fn();
vi.mock("@/lib/platform-access", () => ({
  getPlatformAccessForUser: (...args: unknown[]) => getPlatformAccessForUser(...args),
  hasPlatformRole: (...args: unknown[]) => hasPlatformRole(...args),
}));

import { requireOrganization, requireRole, requirePermission, requirePlatformRole, requireSuperAdmin, ForbiddenError } from "@/lib/auth-guards";

describe("Tenant isolation — PlatformAccess must never substitute for organization membership", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    redirect.mockClear();
    getEffectivePermissions.mockReset();
    getEffectivePermissions.mockResolvedValue([]);
    assertOrganizationAccess.mockClear();
    getPlatformAccessForUser.mockReset();
    hasPlatformRole.mockReset();
  });

  it("a global platform administrator with no membership in Organization B cannot pass requireOrganization() for B", async () => {
    // hasPlatformAccess: true, but no organizationId/role at all — exactly
    // the shape of a SUPER_ADMIN who has never joined this tenant.
    getServerSession.mockResolvedValueOnce({
      userId: "platform-admin-1",
      userEmail: "admin@example.com",
      hasPlatformAccess: true,
      platformRoles: ["SUPER_ADMIN"],
      organizationId: null,
      role: null,
    });

    await expect(requireOrganization()).rejects.toThrow("NEXT_REDIRECT:/onboarding/organization");
  });

  it("requireRole ignores hasPlatformAccess entirely and only ever consults the active-org role", async () => {
    getServerSession.mockResolvedValueOnce({
      userId: "platform-admin-1",
      userEmail: "admin@example.com",
      hasPlatformAccess: true,
      platformRoles: ["SUPER_ADMIN"],
      organizationId: "org-thrivepathmhs",
      // A mere MEMBER in this specific tenant, despite being a global
      // platform admin elsewhere.
      role: "MEMBER",
    });

    await expect(requireRole("ORG_ADMIN", "throw")).rejects.toThrow(ForbiddenError);
  });

  it("requirePermission denies a platform admin who is only a READ_ONLY member of the active organization", async () => {
    getServerSession.mockResolvedValueOnce({
      userId: "platform-admin-1",
      userEmail: "admin@example.com",
      hasPlatformAccess: true,
      platformRoles: ["SUPER_ADMIN"],
      organizationId: "org-thrivepathmhs",
      role: "READ_ONLY",
    });
    getEffectivePermissions.mockResolvedValueOnce([]); // READ_ONLY has no write permissions here

    await expect(requirePermission("members:write", "throw")).rejects.toThrow(ForbiddenError);
  });

  it("switching the active-org cookie/session value does not itself create a membership — an org the session claims but has no real role for is rejected", async () => {
    // Simulates what a forged/guessed cf_active_org would look like if it
    // ever reached this guard without a real membership behind it:
    // organizationId set, but role is null because org-context.ts's
    // resolveActiveOrganization() never found a matching membership.
    getServerSession.mockResolvedValueOnce({
      userId: "platform-admin-1",
      userEmail: "admin@example.com",
      hasPlatformAccess: true,
      platformRoles: ["SUPER_ADMIN"],
      organizationId: "org-guessed-id",
      role: null,
    });

    await expect(requireOrganization()).rejects.toThrow("NEXT_REDIRECT:/onboarding/organization");
  });

  it("the legacy SUPER_ADMIN org role no longer bypasses requirePermission() — it's governed by effective permissions like any other role", async () => {
    getServerSession.mockResolvedValueOnce({
      userId: "legacy-holder",
      userEmail: "legacy@example.com",
      hasPlatformAccess: false,
      platformRoles: [],
      organizationId: "org-thrivepathmhs",
      role: "SUPER_ADMIN",
    });
    // Effective permissions intentionally does NOT include members:write —
    // if SUPER_ADMIN still short-circuited to `true`, this would incorrectly pass.
    getEffectivePermissions.mockResolvedValueOnce(["members:read"]);

    await expect(requirePermission("members:write", "throw")).rejects.toThrow(ForbiddenError);
  });

  it("a real ORG_OWNER membership still passes requireOrganization() normally, platform access or not", async () => {
    getServerSession.mockResolvedValueOnce({
      userId: "user-1",
      userEmail: "owner@example.com",
      hasPlatformAccess: false,
      platformRoles: [],
      organizationId: "org-thrivepathmhs",
      role: "ORG_OWNER",
    });
    getEffectivePermissions.mockResolvedValueOnce(["members:write"]);

    const result = await requireOrganization();
    expect(result.organizationId).toBe("org-thrivepathmhs");
    expect(result.role).toBe("ORG_OWNER");
  });
});

describe("E2E-2 (platform support context): the platform-administration path bypasses the subscription gate through its own independent guard, never through the org gate", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    redirect.mockClear();
    assertOrganizationAccess.mockClear();
    getPlatformAccessForUser.mockReset();
    hasPlatformRole.mockReset();
  });

  it("requirePlatformRole succeeds for a real SUPER_ADMIN grant without ever calling assertOrganizationAccess — no active organization is even read", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "platform-admin-1", userEmail: "admin@example.com" });
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] });
    hasPlatformRole.mockReturnValueOnce(true);

    const result = await requirePlatformRole("SUPER_ADMIN", "throw");

    expect(result.session.userId).toBe("platform-admin-1");
    expect(assertOrganizationAccess).not.toHaveBeenCalled();
  });

  it("requireSuperAdmin succeeds without ever calling assertOrganizationAccess, for an org that would otherwise be billing-denied", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "platform-admin-1", userEmail: "admin@example.com" });
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] });
    hasPlatformRole.mockReturnValueOnce(true);
    assertOrganizationAccess.mockRejectedValue(new Error("would have denied — must never be reached"));

    await expect(requireSuperAdmin("throw")).resolves.toMatchObject({ session: { userId: "platform-admin-1" } });
    expect(assertOrganizationAccess).not.toHaveBeenCalled();
  });

  it("requirePlatformRole still denies a user with no platform grant — independence from the org gate is not a blanket bypass of authorization itself", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1", userEmail: "user@example.com" });
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: false, platformRoles: [] });
    hasPlatformRole.mockReturnValueOnce(false);

    await expect(requirePlatformRole("SUPER_ADMIN", "throw")).rejects.toThrow(ForbiddenError);
  });
});
