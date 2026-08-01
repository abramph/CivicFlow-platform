import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
const requireOrganization = vi.fn();
vi.mock("@/lib/auth-guards", () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  requireOrganization: (...a: unknown[]) => requireOrganization(...a),
}));

const findFirstAdult = vi.fn();
const findUniqueOrganization = vi.fn();
const findFirstMembership = vi.fn();
const findManyLabFeature = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHouseholdAdult: { findFirst: (...a: unknown[]) => findFirstAdult(...a) },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    organizationMembership: { findFirst: (...a: unknown[]) => findFirstMembership(...a) },
    organizationLabFeature: { findMany: (...a: unknown[]) => findManyLabFeature(...a) },
  },
}));

const getOrganizationLabAccess = vi.fn();
vi.mock("@/lib/labs/access", () => ({
  getOrganizationLabAccess: (...a: unknown[]) => getOrganizationLabAccess(...a),
}));

beforeEach(() => vi.clearAllMocks());

describe("requirePtaAccess — PR #40: gated on primaryVertical, never Labs", () => {
  it("denies an organization whose primaryVertical isn't PTA, even with the right permission", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_ADMIN" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY", status: "active" });

    const { requirePtaAccess } = await import("../guard");
    await expect(requirePtaAccess("pta:directory:read")).rejects.toMatchObject({ code: "PTA_ORGANIZATION_NOT_PTA_VERTICAL" });
  });

  it("denies a PTA-vertical organization that is inactive (suspended/cancelled)", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_ADMIN" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA", status: "suspended" });

    const { requirePtaAccess } = await import("../guard");
    await expect(requirePtaAccess("pta:directory:read")).rejects.toMatchObject({ code: "PTA_ORGANIZATION_INACTIVE" });
  });

  it("allows a PTA-vertical, active organization with the right permission — no Labs enrollment involved at all", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_ADMIN" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA", status: "active" });

    const { requirePtaAccess } = await import("../guard");
    const result = await requirePtaAccess("pta:directory:read");
    expect(result.organizationId).toBe("org-a");
    expect(getOrganizationLabAccess).not.toHaveBeenCalled();
  });

  it("checks tenant RBAC permission before the vertical check (fails closed on the first gate)", async () => {
    requirePermission.mockRejectedValueOnce(new Error("Permission denied"));

    const { requirePtaAccess } = await import("../guard");
    await expect(requirePtaAccess("pta:directory:read")).rejects.toThrow("Permission denied");
    expect(findUniqueOrganization).not.toHaveBeenCalled();
  });

  it("never touches meetingIntelligence or any other Labs feature — PTA access is fully independent of Labs", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_ADMIN" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA", status: "active" });

    const { requirePtaAccess } = await import("../guard");
    await requirePtaAccess("pta:directory:read");

    expect(getOrganizationLabAccess).not.toHaveBeenCalled();
  });
});

describe("requirePtaHouseholdSelfAccess — parent self-service, not permission-based", () => {
  it("denies a user whose organization isn't PTA-vertical", async () => {
    requireOrganization.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1", userEmail: "a@example.com" } });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY", status: "active" });

    const { requirePtaHouseholdSelfAccess } = await import("../guard");
    await expect(requirePtaHouseholdSelfAccess()).rejects.toMatchObject({ code: "PTA_ORGANIZATION_NOT_PTA_VERTICAL" });
    expect(findFirstAdult).not.toHaveBeenCalled();
  });

  it("denies a user with no linked household even if they hold an org role", async () => {
    requireOrganization.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1", userEmail: "a@example.com" } });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA", status: "active" });
    findFirstAdult.mockResolvedValueOnce(null);

    const { requirePtaHouseholdSelfAccess } = await import("../guard");
    await expect(requirePtaHouseholdSelfAccess()).rejects.toMatchObject({ code: "PTA_NOT_A_HOUSEHOLD_MEMBER" });
  });

  it("resolves the household strictly from the caller's own userId, scoped to the active organization", async () => {
    requireOrganization.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1", userEmail: "a@example.com" } });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA", status: "active" });
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", householdId: "household-1", household: { id: "household-1", status: "ACTIVE" } });

    const { requirePtaHouseholdSelfAccess } = await import("../guard");
    const result = await requirePtaHouseholdSelfAccess();
    expect(result.adult.householdId).toBe("household-1");
    expect(findFirstAdult).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a", userId: "u1" } }));
  });

  it("denies self-service for a parent linked to a DEACTIVATED household — a household that left the PTA must not keep self-service access (claim slots, RSVP) indefinitely", async () => {
    requireOrganization.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1", userEmail: "a@example.com" } });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA", status: "active" });
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", householdId: "household-1", household: { id: "household-1", status: "INACTIVE" } });

    const { requirePtaHouseholdSelfAccess } = await import("../guard");
    await expect(requirePtaHouseholdSelfAccess()).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_INACTIVE" });
  });

  it("denies self-service for a PENDING household the same way as INACTIVE — only ACTIVE grants self-service", async () => {
    requireOrganization.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1", userEmail: "a@example.com" } });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA", status: "active" });
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", householdId: "household-1", household: { id: "household-1", status: "PENDING" } });

    const { requirePtaHouseholdSelfAccess } = await import("../guard");
    await expect(requirePtaHouseholdSelfAccess()).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_INACTIVE" });
  });
});

describe("getPtaPageGate — page-component variant, never throws", () => {
  it("reports access.available = true for a PTA-vertical active organization", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_ADMIN", can: () => true });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA", status: "active" });

    const { getPtaPageGate } = await import("../guard");
    const gate = await getPtaPageGate("pta:directory:read");
    expect(gate.access.available).toBe(true);
  });

  it("reports access.available = false for a non-PTA organization, without throwing", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_ADMIN", can: () => true });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY", status: "active" });

    const { getPtaPageGate } = await import("../guard");
    const gate = await getPtaPageGate("pta:directory:read");
    expect(gate.access.available).toBe(false);
  });
});

describe("getPtaOrganizationAccessContext — the one server-side PTA access resolver", () => {
  it("computes effectivePtaAccess = true only when primaryVertical is PTA and the org is active", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA", status: "active" });
    findFirstMembership.mockResolvedValueOnce(null);
    findFirstAdult.mockResolvedValueOnce(null);
    findManyLabFeature.mockResolvedValueOnce([]);

    const { getPtaOrganizationAccessContext } = await import("../guard");
    const context = await getPtaOrganizationAccessContext("org-a", "u1");
    expect(context.effectivePtaAccess).toBe(true);
  });

  it("computes effectivePtaAccess = false for a non-PTA organization, regardless of any Labs feature state", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY", status: "active" });
    findFirstMembership.mockResolvedValueOnce(null);
    findFirstAdult.mockResolvedValueOnce(null);
    findManyLabFeature.mockResolvedValueOnce([{ featureKey: "ptaVertical" }]);

    const { getPtaOrganizationAccessContext } = await import("../guard");
    const context = await getPtaOrganizationAccessContext("org-a", "u1");
    expect(context.effectivePtaAccess).toBe(false);
  });

  it("surfaces both officer and household-adult identity facts when both apply to the same caller", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA", status: "active" });
    findFirstMembership.mockResolvedValueOnce({ role: "ORG_OWNER" });
    findFirstAdult.mockResolvedValueOnce({ household: { id: "household-1", status: "ACTIVE" } });
    findManyLabFeature.mockResolvedValueOnce([]);

    const { getPtaOrganizationAccessContext } = await import("../guard");
    const context = await getPtaOrganizationAccessContext("org-a", "u1");
    expect(context.identity.isOfficer).toBe(true);
    expect(context.identity.isHouseholdAdult).toBe(true);
    expect(context.identity.householdId).toBe("household-1");
  });
});
