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

const assertOrganizationAccess = vi.fn();
vi.mock("@/lib/subscription-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/subscription-gate")>();
  return { ...actual, assertOrganizationAccess: (...args: unknown[]) => assertOrganizationAccess(...args) };
});

import { requireOrganization, requirePermission } from "@/lib/auth-guards";
import { SubscriptionRequiredError } from "@/lib/subscription-gate";

const SESSION = { userId: "user-1", userEmail: "a@example.com", organizationId: "org-1", role: "ORG_OWNER" };
const DENIED = new SubscriptionRequiredError("TRIAL_EXPIRED", "Your organization's Unestra trial has ended.");

describe("requireOrganization — LAUNCH-BLOCKER subscription gate wiring", () => {
  beforeEach(() => {
    getServerSession.mockReset().mockResolvedValue(SESSION);
    redirect.mockClear();
    getEffectivePermissions.mockReset().mockResolvedValue(["billing:manage"]);
    assertOrganizationAccess.mockReset();
  });

  it("throw mode: propagates SubscriptionRequiredError to the caller (for withApiErrorHandling to turn into the 402 body)", async () => {
    assertOrganizationAccess.mockRejectedValueOnce(DENIED);

    await expect(requireOrganization("throw")).rejects.toBe(DENIED);
  });

  it("redirect mode: redirects to /subscription-required when access is denied, rather than rendering any protected page content", async () => {
    assertOrganizationAccess.mockRejectedValueOnce(DENIED);

    await expect(requireOrganization("redirect")).rejects.toThrow("NEXT_REDIRECT:/subscription-required");
    expect(redirect).toHaveBeenCalledWith("/subscription-required");
  });

  it("does not call assertOrganizationAccess at all when skipEntitlementGate is set (the explicit recovery-path allowlist)", async () => {
    const result = await requireOrganization("throw", { skipEntitlementGate: true });

    expect(assertOrganizationAccess).not.toHaveBeenCalled();
    expect(result.organizationId).toBe("org-1");
  });

  it("requirePermission propagates skipEntitlementGate through to requireOrganization", async () => {
    await requirePermission("billing:manage", "throw", { skipEntitlementGate: true });

    expect(assertOrganizationAccess).not.toHaveBeenCalled();
  });

  it("a non-SubscriptionRequiredError from assertOrganizationAccess is not swallowed — still propagates", async () => {
    const boom = new Error("unexpected");
    assertOrganizationAccess.mockRejectedValueOnce(boom);

    await expect(requireOrganization("redirect")).rejects.toBe(boom);
    expect(redirect).not.toHaveBeenCalledWith("/subscription-required");
  });

  it("succeeds normally (no redirect, no throw) when access is allowed", async () => {
    assertOrganizationAccess.mockResolvedValueOnce({
      allowed: true,
      reason: null,
      trialEndsAt: null,
      subscriptionStatus: null,
      billingExempt: false,
    });

    const result = await requireOrganization("redirect");

    expect(result.organizationId).toBe("org-1");
    expect(redirect).not.toHaveBeenCalled();
  });
});
