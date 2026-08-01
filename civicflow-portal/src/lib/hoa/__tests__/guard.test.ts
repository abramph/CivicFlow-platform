import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
}));

const findUniqueOrganization = vi.fn();
const findFirstProperty = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    property: { findFirst: (...a: unknown[]) => findFirstProperty(...a) },
  },
}));

const getEffectivePermissions = vi.fn();
vi.mock("@/lib/role-permissions", () => ({
  getEffectivePermissions: (...a: unknown[]) => getEffectivePermissions(...a),
}));

beforeEach(() => vi.clearAllMocks());

describe("requireHoaCapability", () => {
  it("denies an organization whose primaryVertical isn't HOA", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY", status: "active" });
    const { requireHoaCapability } = await import("../guard");
    await expect(requireHoaCapability("org-a")).rejects.toMatchObject({ code: "HOA_ORGANIZATION_NOT_HOA_VERTICAL" });
  });

  it("denies a HOA-vertical organization that is inactive", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "HOA", status: "suspended" });
    const { requireHoaCapability } = await import("../guard");
    await expect(requireHoaCapability("org-a")).rejects.toMatchObject({ code: "HOA_ORGANIZATION_INACTIVE" });
  });

  it("denies when the organization doesn't exist", async () => {
    findUniqueOrganization.mockResolvedValueOnce(null);
    const { requireHoaCapability } = await import("../guard");
    await expect(requireHoaCapability("org-missing")).rejects.toMatchObject({ code: "HOA_ORGANIZATION_NOT_HOA_VERTICAL" });
  });

  it("succeeds for an active HOA organization", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "HOA", status: "active" });
    const { requireHoaCapability } = await import("../guard");
    await expect(requireHoaCapability("org-a")).resolves.toMatchObject({ primaryVertical: "HOA", status: "active" });
  });
});

describe("checkHoaCapabilityAvailable", () => {
  it("returns available:false instead of throwing when denied", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY", status: "active" });
    const { checkHoaCapabilityAvailable } = await import("../guard");
    await expect(checkHoaCapabilityAvailable("org-a")).resolves.toEqual({ available: false });
  });

  it("returns available:true when allowed", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "HOA", status: "active" });
    const { checkHoaCapabilityAvailable } = await import("../guard");
    await expect(checkHoaCapabilityAvailable("org-a")).resolves.toEqual({ available: true });
  });
});

describe("requireHoaPropertyRead / requireHoaPropertyWrite / requireHoaResidentRead / requireHoaResidentWrite", () => {
  it("requireHoaPropertyRead requires hoa:properties:read AND the HOA capability", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_ADMIN" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "HOA", status: "active" });
    const { requireHoaPropertyRead } = await import("../guard");
    await requireHoaPropertyRead();
    expect(requirePermission).toHaveBeenCalledWith("hoa:properties:read", "throw");
  });

  it("requireHoaPropertyWrite requires hoa:properties:write", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_ADMIN" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "HOA", status: "active" });
    const { requireHoaPropertyWrite } = await import("../guard");
    await requireHoaPropertyWrite();
    expect(requirePermission).toHaveBeenCalledWith("hoa:properties:write", "throw");
  });

  it("requireHoaResidentRead requires hoa:residents:read", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "FINANCE" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "HOA", status: "active" });
    const { requireHoaResidentRead } = await import("../guard");
    await requireHoaResidentRead();
    expect(requirePermission).toHaveBeenCalledWith("hoa:residents:read", "throw");
  });

  it("requireHoaResidentWrite requires hoa:residents:write, and still denies a Community org holding the permission", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-community", session: { userId: "u1" }, role: "ORG_ADMIN" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY", status: "active" });
    const { requireHoaResidentWrite } = await import("../guard");
    await expect(requireHoaResidentWrite()).rejects.toMatchObject({ code: "HOA_ORGANIZATION_NOT_HOA_VERTICAL" });
  });
});

describe("getHoaPropertyAccessContext", () => {
  it("resolves a property strictly scoped to the active organization", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "HOA", status: "active" });
    findFirstProperty.mockResolvedValueOnce({ id: "prop-1", addressLine1: "142 Oak Ridge Drive", propertyType: "SINGLE_FAMILY", status: "ACTIVE", billingMemberId: "member-1" });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:properties:read"]);

    const { getHoaPropertyAccessContext } = await import("../guard");
    const context = await getHoaPropertyAccessContext("org-a", "prop-1", "ORG_ADMIN");

    expect(findFirstProperty).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "prop-1", organizationId: "org-a" } }));
    expect(context.property.id).toBe("prop-1");
  });

  it("throws HOA_PROPERTY_NOT_FOUND for a cross-tenant property id -- never leaks whether it exists elsewhere", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "HOA", status: "active" });
    findFirstProperty.mockResolvedValueOnce(null);

    const { getHoaPropertyAccessContext } = await import("../guard");
    await expect(getHoaPropertyAccessContext("org-a", "prop-from-another-org", "ORG_ADMIN")).rejects.toMatchObject({
      code: "HOA_PROPERTY_NOT_FOUND",
    });
  });
});
