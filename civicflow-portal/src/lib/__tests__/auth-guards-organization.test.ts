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

import {
  requireOrganization,
  requirePermission,
  requireRole,
  UnauthenticatedError,
  OrganizationRequiredError,
  ForbiddenError,
} from "@/lib/auth-guards";

/**
 * Regression coverage for GitHub issue #41: requireOrganization() previously
 * had no non-redirect mode at all, so any API route calling it (or calling
 * requirePermission/requireRole with onForbidden: "throw") still hit an
 * uncaught redirect() -- which throws Next.js's internal NEXT_REDIRECT and
 * surfaces as an unhandled 500 outside of a page render -- the moment a
 * user's active organization/membership became invalid mid-session.
 */
describe("requireOrganization — throw mode (issue #41)", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    redirect.mockClear();
    getEffectivePermissions.mockReset();
  });

  it("throws UnauthenticatedError (401) instead of redirecting when there is no session", async () => {
    getServerSession.mockResolvedValueOnce(null);
    await expect(requireOrganization("throw")).rejects.toThrow(UnauthenticatedError);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("throws OrganizationRequiredError (409) instead of redirecting when the session has no active organization", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1", userEmail: "a@example.com", organizationId: null, role: null });
    await expect(requireOrganization("throw")).rejects.toThrow(OrganizationRequiredError);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("still redirects (default mode, unchanged) when there is no session", async () => {
    getServerSession.mockResolvedValueOnce(null);
    await expect(requireOrganization()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("still redirects (default mode, unchanged) when there is no active organization", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1", userEmail: "a@example.com", organizationId: null, role: null });
    await expect(requireOrganization()).rejects.toThrow("NEXT_REDIRECT:/onboarding/organization");
  });

  it("succeeds normally when the session has a valid active organization", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1", userEmail: "a@example.com", organizationId: "org-1", role: "STAFF" });
    getEffectivePermissions.mockResolvedValueOnce(["events:read"]);
    const result = await requireOrganization("throw");
    expect(result.organizationId).toBe("org-1");
    expect(result.can("events:read")).toBe(true);
  });

  describe("requirePermission propagates onForbidden into the organization check (the actual gap in issue #41)", () => {
    it("throw mode: a revoked/missing organization throws OrganizationRequiredError, not an uncaught redirect", async () => {
      getServerSession.mockResolvedValueOnce({ userId: "user-1", userEmail: "a@example.com", organizationId: null, role: null });
      await expect(requirePermission("events:write", "throw")).rejects.toThrow(OrganizationRequiredError);
      expect(redirect).not.toHaveBeenCalled();
    });

    it("throw mode: an authenticated user lacking the permission still throws ForbiddenError as before", async () => {
      getServerSession.mockResolvedValueOnce({ userId: "user-1", userEmail: "a@example.com", organizationId: "org-1", role: "READ_ONLY" });
      getEffectivePermissions.mockResolvedValueOnce([]);
      await expect(requirePermission("events:write", "throw")).rejects.toThrow(ForbiddenError);
    });

    it("redirect mode (default, unchanged): a missing organization still redirects to onboarding", async () => {
      getServerSession.mockResolvedValueOnce({ userId: "user-1", userEmail: "a@example.com", organizationId: null, role: null });
      await expect(requirePermission("events:write")).rejects.toThrow("NEXT_REDIRECT:/onboarding/organization");
    });
  });

  describe("requireRole propagates onForbidden into the organization check", () => {
    it("throw mode: a revoked/missing organization throws OrganizationRequiredError", async () => {
      getServerSession.mockResolvedValueOnce({ userId: "user-1", userEmail: "a@example.com", organizationId: null, role: null });
      await expect(requireRole("ORG_ADMIN", "throw")).rejects.toThrow(OrganizationRequiredError);
    });

    it("throw mode: an authenticated user below the minimum role still throws ForbiddenError", async () => {
      getServerSession.mockResolvedValueOnce({ userId: "user-1", userEmail: "a@example.com", organizationId: "org-1", role: "STAFF" });
      getEffectivePermissions.mockResolvedValueOnce([]);
      await expect(requireRole("ORG_ADMIN", "throw")).rejects.toThrow(ForbiddenError);
    });
  });
});
