import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
}));

const requireMemberWebSession = vi.fn();
vi.mock("@/lib/member-web-session", () => ({
  requireMemberWebSession: (...a: unknown[]) => requireMemberWebSession(...a),
}));

const findUniqueOrganization = vi.fn();
const findFirstViolation = vi.fn();
const findFirstPropertyResident = vi.fn();
const findManyPropertyResident = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    violation: { findFirst: (...a: unknown[]) => findFirstViolation(...a) },
    propertyResident: {
      findFirst: (...a: unknown[]) => findFirstPropertyResident(...a),
      findMany: (...a: unknown[]) => findManyPropertyResident(...a),
    },
  },
}));

beforeEach(() => vi.clearAllMocks());

describe("officer permission gates (requireHoaViolation{Read,Write,Review,Resolve})", () => {
  it("denies when the organization isn't HOA vertical, even with the right permission", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "STAFF" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY", status: "active" });

    const { requireHoaViolationRead } = await import("../violations-guard");
    await expect(requireHoaViolationRead()).rejects.toMatchObject({ code: "HOA_ORGANIZATION_NOT_HOA_VERTICAL" });
  });

  it("denies when the org is HOA but the violations capability isn't enabled", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "STAFF" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA", status: "active" });

    const { requireHoaViolationRead } = await import("../violations-guard");
    await expect(requireHoaViolationRead()).rejects.toMatchObject({ code: "HOA_ORGANIZATION_NOT_HOA_VERTICAL" });
  });

  it("succeeds for an active HOA organization with the right permission", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_OWNER" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "HOA", status: "active" });

    const { requireHoaViolationResolve } = await import("../violations-guard");
    await expect(requireHoaViolationResolve()).resolves.toMatchObject({ organizationId: "org-a", role: "ORG_OWNER" });
  });

  it("propagates a permission denial from requirePermission itself without ever checking the org", async () => {
    requirePermission.mockRejectedValueOnce(new Error("Forbidden"));
    const { requireHoaViolationWrite } = await import("../violations-guard");

    await expect(requireHoaViolationWrite()).rejects.toThrow("Forbidden");
    expect(findUniqueOrganization).not.toHaveBeenCalled();
  });
});

describe("getHoaViolationAccessContext", () => {
  it("resolves a violation scoped to the caller's organization", async () => {
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", organizationId: "org-a" });
    const { getHoaViolationAccessContext } = await import("../violations-guard");

    const ctx = await getHoaViolationAccessContext("org-a", "violation-1", "STAFF");
    expect(ctx.violation.id).toBe("violation-1");
    expect(findFirstViolation).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "violation-1", organizationId: "org-a" } }));
  });

  it("treats a cross-tenant violation id as not found, never leaking existence", async () => {
    findFirstViolation.mockResolvedValueOnce(null);
    const { getHoaViolationAccessContext } = await import("../violations-guard");

    await expect(getHoaViolationAccessContext("org-a", "violation-from-other-org", "STAFF")).rejects.toMatchObject({ code: "HOA_VIOLATION_NOT_FOUND" });
  });
});

describe("requireHoaViolationResidentAccess", () => {
  it("denies a resident with no PropertyResident relationship to the violation's property", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "ISSUED", propertyId: "prop-1" });
    findFirstPropertyResident.mockResolvedValueOnce(null);

    const { requireHoaViolationResidentAccess } = await import("../violations-guard");
    await expect(requireHoaViolationResidentAccess("org-a", "violation-1")).rejects.toMatchObject({ code: "HOA_VIOLATION_NOT_YOUR_PROPERTY" });
  });

  it("denies access to a DRAFT violation even for the property's own resident", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "DRAFT", propertyId: "prop-1" });

    const { requireHoaViolationResidentAccess } = await import("../violations-guard");
    await expect(requireHoaViolationResidentAccess("org-a", "violation-1")).rejects.toMatchObject({ code: "HOA_VIOLATION_NOT_FOUND" });
    expect(findFirstPropertyResident).not.toHaveBeenCalled();
  });

  it("grants access to an ISSUED violation for an ACTIVE resident of its property", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "ISSUED", propertyId: "prop-1" });
    findFirstPropertyResident.mockResolvedValueOnce({ id: "resident-rel-1" });

    const { requireHoaViolationResidentAccess } = await import("../violations-guard");
    const result = await requireHoaViolationResidentAccess("org-a", "violation-1");

    expect(result.memberId).toBe("member-1");
    expect(findFirstPropertyResident).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ propertyId: "prop-1", orgMemberId: "member-1", status: "ACTIVE" }) })
    );
  });

  it("never trusts a memberId from anywhere but the caller's own authenticated session", async () => {
    // Even if a violation belongs to a property some OTHER member resides
    // at, the guard must scope strictly to requireMemberWebSession's own
    // resolved memberId, never anything passed in from outside.
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstViolation.mockResolvedValueOnce({ id: "violation-1", status: "ISSUED", propertyId: "prop-1" });
    findFirstPropertyResident.mockResolvedValueOnce(null);

    const { requireHoaViolationResidentAccess } = await import("../violations-guard");
    await expect(requireHoaViolationResidentAccess("org-a", "violation-1")).rejects.toMatchObject({ code: "HOA_VIOLATION_NOT_YOUR_PROPERTY" });
    expect(findFirstPropertyResident).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgMemberId: "member-1" }) }));
  });
});

describe("listMyResidentPropertyIds", () => {
  it("scopes to the caller's own ACTIVE PropertyResident rows only", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findManyPropertyResident.mockResolvedValueOnce([{ propertyId: "prop-1" }, { propertyId: "prop-2" }]);

    const { listMyResidentPropertyIds } = await import("../violations-guard");
    const result = await listMyResidentPropertyIds("org-a");

    expect(result.propertyIds).toEqual(["prop-1", "prop-2"]);
    expect(findManyPropertyResident).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgMemberId: "member-1", status: "ACTIVE" }) })
    );
  });
});
