import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstMembership = vi.fn();
const findUniqueOrganization = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationMembership: { findFirst: (...args: unknown[]) => findFirstMembership(...args) },
    organization: { findUnique: (...args: unknown[]) => findUniqueOrganization(...args) },
  },
}));

const getEffectivePermissionsMock = vi.fn();
vi.mock("@/lib/role-permissions", () => ({
  getEffectivePermissions: (...args: unknown[]) => getEffectivePermissionsMock(...args),
}));

const getOrganizationLabAccessMock = vi.fn();
vi.mock("@/lib/labs/access", () => ({
  getOrganizationLabAccess: (...args: unknown[]) => getOrganizationLabAccessMock(...args),
}));

const assertOrganizationAccess = vi.fn();
vi.mock("@/lib/subscription-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/subscription-gate")>();
  return { ...actual, assertOrganizationAccess: (...args: unknown[]) => assertOrganizationAccess(...args) };
});

import { resolveMobileAdminCapabilities, requireMobileAdminAccess, MOBILE_ADMIN_LABS_FEATURE_KEY } from "@/lib/mobile-admin";
import { SubscriptionRequiredError } from "@/lib/subscription-gate";

function labAccess(available: boolean) {
  return { featureKey: MOBILE_ADMIN_LABS_FEATURE_KEY, exists: true, lifecycle: "INTERNAL", entitled: true, enrolled: available, enabled: available, available, denialReason: available ? null : "LAB_FEATURE_NOT_ENROLLED" };
}

describe("resolveMobileAdminCapabilities", () => {
  beforeEach(() => {
    findFirstMembership.mockReset();
    findUniqueOrganization.mockReset();
    getEffectivePermissionsMock.mockReset();
    getOrganizationLabAccessMock.mockReset();
  });

  it("returns empty when the org is not enrolled in the mobileAdmin Labs feature — skips every other lookup", async () => {
    getOrganizationLabAccessMock.mockResolvedValueOnce(labAccess(false));

    const result = await resolveMobileAdminCapabilities("org-a", "user-1");

    expect(result).toEqual({ available: false, role: null, adminCapabilities: [] });
    expect(findFirstMembership).not.toHaveBeenCalled();
    expect(getEffectivePermissionsMock).not.toHaveBeenCalled();
  });

  it("returns empty when the org is enrolled but the caller has no staff membership", async () => {
    getOrganizationLabAccessMock.mockResolvedValueOnce(labAccess(true));
    findFirstMembership.mockResolvedValueOnce(null);

    const result = await resolveMobileAdminCapabilities("org-a", "user-1");

    expect(result.available).toBe(false);
    expect(getEffectivePermissionsMock).not.toHaveBeenCalled();
  });

  it("maps members:write to manageMembers and includes adminDashboard when any flag is present", async () => {
    getOrganizationLabAccessMock.mockResolvedValueOnce(labAccess(true));
    findFirstMembership.mockResolvedValueOnce({ role: "STAFF" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY" });
    getEffectivePermissionsMock.mockResolvedValueOnce(["members:write"]);

    const result = await resolveMobileAdminCapabilities("org-a", "user-1");

    expect(result.available).toBe(true);
    expect(result.role).toBe("STAFF");
    expect(result.adminCapabilities).toEqual(["adminDashboard", "manageMembers"]);
  });

  it("does not grant manageMembers on a PTA org even with members:write -- PTA doesn't use OrgMember as its roster", async () => {
    getOrganizationLabAccessMock.mockResolvedValueOnce(labAccess(true));
    findFirstMembership.mockResolvedValueOnce({ role: "ORG_OWNER" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA" });
    getEffectivePermissionsMock.mockResolvedValueOnce(["members:write"]);

    const result = await resolveMobileAdminCapabilities("org-a", "user-1");

    expect(result.adminCapabilities).not.toContain("manageMembers");
    expect(result.available).toBe(false);
  });

  it("does not grant managePtaHouseholds on a non-PTA org even if the permission string is somehow present", async () => {
    getOrganizationLabAccessMock.mockResolvedValueOnce(labAccess(true));
    findFirstMembership.mockResolvedValueOnce({ role: "ORG_OWNER" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY" });
    getEffectivePermissionsMock.mockResolvedValueOnce(["pta:households:manage"]);

    const result = await resolveMobileAdminCapabilities("org-a", "user-1");

    expect(result.adminCapabilities).not.toContain("managePtaHouseholds");
    expect(result.available).toBe(false);
  });

  it("grants managePtaHouseholds on a real PTA org with the matching permission", async () => {
    getOrganizationLabAccessMock.mockResolvedValueOnce(labAccess(true));
    findFirstMembership.mockResolvedValueOnce({ role: "ORG_OWNER" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA" });
    getEffectivePermissionsMock.mockResolvedValueOnce(["pta:households:manage"]);

    const result = await resolveMobileAdminCapabilities("org-a", "user-1");

    expect(result.adminCapabilities).toContain("managePtaHouseholds");
  });

  it("only grants manageHoaArchitecturalRequests when the vertical capability flag is also on, not just the permission+vertical", async () => {
    getOrganizationLabAccessMock.mockResolvedValueOnce(labAccess(true));
    findFirstMembership.mockResolvedValueOnce({ role: "ORG_OWNER" });
    // HOA has architecturalRequests: true per vertical-capabilities.ts, so this should grant it.
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "HOA" });
    getEffectivePermissionsMock.mockResolvedValueOnce(["hoa:architectural-requests:write"]);

    const result = await resolveMobileAdminCapabilities("org-a", "user-1");

    expect(result.adminCapabilities).toContain("manageHoaArchitecturalRequests");
  });

  it("maps imports:create + UNION vertical to manageUnionPayrollCheckoff", async () => {
    getOrganizationLabAccessMock.mockResolvedValueOnce(labAccess(true));
    findFirstMembership.mockResolvedValueOnce({ role: "ORG_OWNER" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "UNION" });
    getEffectivePermissionsMock.mockResolvedValueOnce(["imports:create"]);

    const result = await resolveMobileAdminCapabilities("org-a", "user-1");

    expect(result.adminCapabilities).toContain("manageUnionPayrollCheckoff");
  });

  it("returns available: false with an empty array when the role has none of the mapped permissions", async () => {
    getOrganizationLabAccessMock.mockResolvedValueOnce(labAccess(true));
    findFirstMembership.mockResolvedValueOnce({ role: "STAFF" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY" });
    getEffectivePermissionsMock.mockResolvedValueOnce(["receipts:read"]);

    const result = await resolveMobileAdminCapabilities("org-a", "user-1");

    expect(result).toEqual({ available: false, role: "STAFF", adminCapabilities: [] });
  });
});

describe("requireMobileAdminAccess — the LAUNCH-BLOCKER subscription-gated wrapper", () => {
  beforeEach(() => {
    findFirstMembership.mockReset();
    findUniqueOrganization.mockReset();
    getEffectivePermissionsMock.mockReset();
    getOrganizationLabAccessMock.mockReset();
    assertOrganizationAccess.mockReset();
  });

  it("throws SubscriptionRequiredError before doing any capability lookup when the organization is billing-inactive", async () => {
    assertOrganizationAccess.mockRejectedValueOnce(new SubscriptionRequiredError("TRIAL_EXPIRED", "Your organization's Unestra trial has ended."));

    await expect(requireMobileAdminAccess("org-a", "user-1")).rejects.toBeInstanceOf(SubscriptionRequiredError);
    expect(getOrganizationLabAccessMock).not.toHaveBeenCalled();
  });

  it("delegates to resolveMobileAdminCapabilities and returns its result when access is allowed", async () => {
    assertOrganizationAccess.mockResolvedValueOnce({
      allowed: true,
      reason: null,
      trialEndsAt: null,
      subscriptionStatus: null,
      billingExempt: false,
    });
    getOrganizationLabAccessMock.mockResolvedValueOnce(labAccess(true));
    findFirstMembership.mockResolvedValueOnce({ role: "ORG_OWNER" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY" });
    getEffectivePermissionsMock.mockResolvedValueOnce(["members:write"]);

    const result = await requireMobileAdminAccess("org-a", "user-1");

    expect(result.role).toBe("ORG_OWNER");
  });
});
