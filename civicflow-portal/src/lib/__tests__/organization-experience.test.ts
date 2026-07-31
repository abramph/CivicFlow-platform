import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrganization = vi.fn();
const findManyLabFeature = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...args: unknown[]) => findUniqueOrganization(...args) },
    organizationLabFeature: { findMany: (...args: unknown[]) => findManyLabFeature(...args) },
  },
}));

const getEffectivePermissions = vi.fn();
vi.mock("@/lib/role-permissions", () => ({
  getEffectivePermissions: (...args: unknown[]) => getEffectivePermissions(...args),
}));

const getOrganizationEntitlements = vi.fn();
vi.mock("@/lib/plan-gate", () => ({
  getOrganizationEntitlements: (...args: unknown[]) => getOrganizationEntitlements(...args),
}));

import { OrganizationNotFoundError, resolveOrganizationExperience } from "@/lib/organization-experience";

describe("resolveOrganizationExperience", () => {
  beforeEach(() => {
    findUniqueOrganization.mockReset();
    findManyLabFeature.mockReset();
    getEffectivePermissions.mockReset();
    getOrganizationEntitlements.mockReset();
  });

  it("composes vertical, entitlements, labs, permissions, and terminology from server-resolved inputs only", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ id: "org-1", name: "Pine Grove School PTA", primaryVertical: "PTA", status: "active" });
    findManyLabFeature.mockResolvedValueOnce([{ featureKey: "ptaVertical" }]);
    getEffectivePermissions.mockResolvedValueOnce(["members:read", "members:write"]);
    getOrganizationEntitlements.mockResolvedValueOnce({ planId: "free", planName: "Free" });

    const result = await resolveOrganizationExperience({ organizationId: "org-1", role: "ORG_OWNER" });

    expect(result.primaryVertical).toBe("PTA");
    expect(result.enabledLabFeatures).toEqual(["ptaVertical"]);
    expect(result.permissions).toEqual(["members:read", "members:write"]);
    expect(result.terminology.member).toBe("Parent");
    expect(getEffectivePermissions).toHaveBeenCalledWith("org-1", "ORG_OWNER");
  });

  it("throws when the organization doesn't exist rather than returning a partial/undefined experience", async () => {
    findUniqueOrganization.mockResolvedValueOnce(null);
    findManyLabFeature.mockResolvedValueOnce([]);
    getEffectivePermissions.mockResolvedValueOnce([]);
    getOrganizationEntitlements.mockResolvedValueOnce({});

    await expect(resolveOrganizationExperience({ organizationId: "missing", role: "MEMBER" })).rejects.toThrow(
      OrganizationNotFoundError
    );
  });

  it("never derives primaryVertical from anything other than the database row", async () => {
    // Even though role/organizationId are caller-supplied, the vertical always
    // comes from the org.findUnique lookup — there is no parameter through
    // which a caller could inject a different vertical.
    findUniqueOrganization.mockResolvedValueOnce({ id: "org-2", name: "Riverdale", primaryVertical: "COMMUNITY", status: "active" });
    findManyLabFeature.mockResolvedValueOnce([]);
    getEffectivePermissions.mockResolvedValueOnce([]);
    getOrganizationEntitlements.mockResolvedValueOnce({});

    const result = await resolveOrganizationExperience({ organizationId: "org-2", role: "MEMBER" });
    expect(result.primaryVertical).toBe("COMMUNITY");
  });
});
