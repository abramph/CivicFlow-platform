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

import { requireOrganization, requireRole, requirePermission, ForbiddenError } from "@/lib/auth-guards";

describe("Tenant isolation — PlatformAccess must never substitute for organization membership", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    redirect.mockClear();
    getEffectivePermissions.mockReset();
    getEffectivePermissions.mockResolvedValue([]);
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
