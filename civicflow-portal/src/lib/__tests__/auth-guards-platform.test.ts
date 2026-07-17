import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }));

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (...args: [string]) => redirect(...args) }));

const getPlatformAccessForUser = vi.fn();
vi.mock("@/lib/platform-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/platform-access")>("@/lib/platform-access");
  return { ...actual, getPlatformAccessForUser: (...args: unknown[]) => getPlatformAccessForUser(...args) };
});

// authOptions itself pulls in a long chain of real dependencies (Prisma,
// bcrypt, org-context, etc.) that these tests have no business touching —
// the guards only ever pass it through to getServerSession, which is
// already mocked above, so a bare stub is enough.
vi.mock("@/lib/authOptions", () => ({ authOptions: {} }));

import { requireSuperAdmin, requirePlatformRole, ForbiddenError } from "@/lib/auth-guards";

describe("requirePlatformRole / requireSuperAdmin — global, organization-independent", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    redirect.mockClear();
    getPlatformAccessForUser.mockReset();
  });

  it("denies (throw mode) an unauthenticated request without ever checking platform access", async () => {
    getServerSession.mockResolvedValueOnce(null);

    await expect(requireSuperAdmin("throw")).rejects.toThrow(ForbiddenError);
    expect(getPlatformAccessForUser).not.toHaveBeenCalled();
  });

  it("redirects to /login (redirect mode) when unauthenticated", async () => {
    getServerSession.mockResolvedValueOnce(null);

    await expect(requireSuperAdmin("redirect")).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("denies an authenticated user with zero platform access", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1", userEmail: "owner@example.com" });
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: false, platformRoles: [] });

    await expect(requireSuperAdmin("throw")).rejects.toThrow(ForbiddenError);
  });

  it("denies a user whose platform access is for a different role", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1", userEmail: "someone@example.com" });
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: true, platformRoles: [] });

    await expect(requireSuperAdmin("throw")).rejects.toThrow(ForbiddenError);
  });

  it("allows a user with an ACTIVE SUPER_ADMIN platform grant, regardless of organizationId/role on the session", async () => {
    getServerSession.mockResolvedValueOnce({
      userId: "user-1",
      userEmail: "admin@example.com",
      // Deliberately organizationId: null, role: null — an org-less session
      // must still pass this guard. This is the core of the migration.
      organizationId: null,
      role: null,
    });
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] });

    const result = await requireSuperAdmin("throw");

    expect(result.session).toEqual({ userId: "user-1", userEmail: "admin@example.com" });
  });

  it("allows the same user regardless of which organization is their active session org", async () => {
    getPlatformAccessForUser.mockResolvedValue({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] });

    getServerSession.mockResolvedValueOnce({ userId: "user-1", userEmail: "a@example.com", organizationId: "org-aph" });
    await expect(requireSuperAdmin("throw")).resolves.toBeTruthy();

    getServerSession.mockResolvedValueOnce({ userId: "user-1", userEmail: "a@example.com", organizationId: "org-thrivepathmhs" });
    await expect(requireSuperAdmin("throw")).resolves.toBeTruthy();

    // Never once consulted organizationId to decide the outcome.
    expect(getPlatformAccessForUser).toHaveBeenCalledTimes(2);
    expect(getPlatformAccessForUser).toHaveBeenNthCalledWith(1, "user-1");
    expect(getPlatformAccessForUser).toHaveBeenNthCalledWith(2, "user-1");
  });

  it("does not grant SUPER_ADMIN platform access merely because the session's active-org role happens to be an org-level SUPER_ADMIN OrgRole", async () => {
    // Regression guard: this migration's whole point is that the two
    // concepts are separate. A stale/legacy OrgRole.SUPER_ADMIN membership
    // must not be treated as global platform access.
    getServerSession.mockResolvedValueOnce({ userId: "user-1", userEmail: "a@example.com", organizationId: "org-x", role: "SUPER_ADMIN" });
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: false, platformRoles: [] });

    await expect(requireSuperAdmin("throw")).rejects.toThrow(ForbiddenError);
  });

  it("requirePlatformRole checks the exact role requested, not just \"any platform access\"", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1", userEmail: "a@example.com" });
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] });

    await expect(requirePlatformRole("SUPER_ADMIN", "throw")).resolves.toBeTruthy();
  });
});
