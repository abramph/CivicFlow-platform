import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
const requireOrganization = vi.fn();
vi.mock("@/lib/auth-guards", () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  requireOrganization: (...a: unknown[]) => requireOrganization(...a),
}));

const requireOrganizationLabFeature = vi.fn();
const getOrganizationLabAccess = vi.fn();
vi.mock("@/lib/labs/access", () => ({
  requireOrganizationLabFeature: (...a: unknown[]) => requireOrganizationLabFeature(...a),
  getOrganizationLabAccess: (...a: unknown[]) => getOrganizationLabAccess(...a),
}));

const findFirstAdult = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { ptaHouseholdAdult: { findFirst: (...a: unknown[]) => findFirstAdult(...a) } },
}));

beforeEach(() => vi.clearAllMocks());

describe("requirePtaAccess — Labs gating", () => {
  it("denies an unenrolled organization even with the right permission", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_ADMIN" });
    requireOrganizationLabFeature.mockRejectedValueOnce(new Error("LAB_FEATURE_NOT_ENROLLED"));

    const { requirePtaAccess } = await import("../guard");
    await expect(requirePtaAccess("pta:directory:read")).rejects.toThrow();
    // The Labs check is called with the exact feature key "ptaVertical" — a
    // typo here would silently gate against the wrong feature.
    expect(requireOrganizationLabFeature).toHaveBeenCalledWith("org-a", "ptaVertical");
  });

  it("allows an enrolled organization with the right permission", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_ADMIN" });
    requireOrganizationLabFeature.mockResolvedValueOnce(undefined);

    const { requirePtaAccess } = await import("../guard");
    const result = await requirePtaAccess("pta:directory:read");
    expect(result.organizationId).toBe("org-a");
  });

  it("checks tenant RBAC permission before the Labs feature (fails closed on the first gate)", async () => {
    requirePermission.mockRejectedValueOnce(new Error("Permission denied"));

    const { requirePtaAccess } = await import("../guard");
    await expect(requirePtaAccess("pta:directory:read")).rejects.toThrow("Permission denied");
    expect(requireOrganizationLabFeature).not.toHaveBeenCalled();
  });

  it("never touches meetingIntelligence enrollment — PTA access is fully independent", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_ADMIN" });
    requireOrganizationLabFeature.mockResolvedValueOnce(undefined);

    const { requirePtaAccess } = await import("../guard");
    await requirePtaAccess("pta:directory:read");

    for (const call of requireOrganizationLabFeature.mock.calls) {
      expect(call[1]).not.toBe("meetingIntelligence");
    }
  });
});

describe("requirePtaHouseholdSelfAccess — parent self-service, not permission-based", () => {
  it("denies a user with no linked household even if they hold an org role", async () => {
    requireOrganization.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1", userEmail: "a@example.com" } });
    requireOrganizationLabFeature.mockResolvedValueOnce(undefined);
    findFirstAdult.mockResolvedValueOnce(null);

    const { requirePtaHouseholdSelfAccess } = await import("../guard");
    await expect(requirePtaHouseholdSelfAccess()).rejects.toMatchObject({ code: "PTA_NOT_A_HOUSEHOLD_MEMBER" });
  });

  it("resolves the household strictly from the caller's own userId, scoped to the active organization", async () => {
    requireOrganization.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1", userEmail: "a@example.com" } });
    requireOrganizationLabFeature.mockResolvedValueOnce(undefined);
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", householdId: "household-1", household: { id: "household-1", status: "ACTIVE" } });

    const { requirePtaHouseholdSelfAccess } = await import("../guard");
    const result = await requirePtaHouseholdSelfAccess();
    expect(result.adult.householdId).toBe("household-1");
    expect(findFirstAdult).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a", userId: "u1" } }));
  });

  it("denies self-service for a parent linked to a DEACTIVATED household — caught during hardening review: without this check, a household that left the PTA kept full self-service access (claim slots, RSVP) indefinitely", async () => {
    requireOrganization.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1", userEmail: "a@example.com" } });
    requireOrganizationLabFeature.mockResolvedValueOnce(undefined);
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", householdId: "household-1", household: { id: "household-1", status: "INACTIVE" } });

    const { requirePtaHouseholdSelfAccess } = await import("../guard");
    await expect(requirePtaHouseholdSelfAccess()).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_INACTIVE" });
  });

  it("denies self-service for a PENDING household the same way as INACTIVE — only ACTIVE grants self-service", async () => {
    requireOrganization.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1", userEmail: "a@example.com" } });
    requireOrganizationLabFeature.mockResolvedValueOnce(undefined);
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", householdId: "household-1", household: { id: "household-1", status: "PENDING" } });

    const { requirePtaHouseholdSelfAccess } = await import("../guard");
    await expect(requirePtaHouseholdSelfAccess()).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_INACTIVE" });
  });
});
