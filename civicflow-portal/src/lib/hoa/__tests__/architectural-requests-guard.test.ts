import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
}));

const requireMemberWebSession = vi.fn();
vi.mock("@/lib/member-web-session", () => ({
  requireMemberWebSession: (...a: unknown[]) => requireMemberWebSession(...a),
}));

const hasVerticalCapability = vi.fn();
vi.mock("@/lib/vertical-capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vertical-capabilities")>();
  return { ...actual, hasVerticalCapability: (...a: Parameters<typeof actual.hasVerticalCapability>) => hasVerticalCapability(...a) };
});

const findUniqueOrganization = vi.fn();
const findFirstArchitecturalRequest = vi.fn();
const findFirstPropertyResident = vi.fn();
const findManyArchitecturalRequest = vi.fn();
const findManyPropertyResident = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    architecturalRequest: {
      findFirst: (...a: unknown[]) => findFirstArchitecturalRequest(...a),
      findMany: (...a: unknown[]) => findManyArchitecturalRequest(...a),
    },
    propertyResident: {
      findFirst: (...a: unknown[]) => findFirstPropertyResident(...a),
      findMany: (...a: unknown[]) => findManyPropertyResident(...a),
    },
  },
}));

beforeEach(async () => {
  vi.clearAllMocks();
  const actual = await vi.importActual<typeof import("@/lib/vertical-capabilities")>("@/lib/vertical-capabilities");
  hasVerticalCapability.mockImplementation(actual.hasVerticalCapability);
});

describe("officer permission gates (requireArchitecturalRequest{Read,Write,Review,Decide})", () => {
  it("denies when the organization isn't HOA vertical, even with the right permission", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "STAFF" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY", status: "active" });

    const { requireArchitecturalRequestRead } = await import("../architectural-requests-guard");
    await expect(requireArchitecturalRequestRead()).rejects.toMatchObject({ code: "HOA_ORGANIZATION_NOT_HOA_VERTICAL" });
  });

  it("denies a genuinely-HOA organization whose 'architecturalRequests' capability flag is off", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "STAFF" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "HOA", status: "active" });
    hasVerticalCapability.mockImplementation((_vertical: string, flag: string) => flag !== "architecturalRequests");

    const { requireArchitecturalRequestRead } = await import("../architectural-requests-guard");
    await expect(requireArchitecturalRequestRead()).rejects.toMatchObject({ code: "HOA_ARCHITECTURAL_REQUESTS_NOT_ENABLED" });
  });

  it("succeeds for an active HOA organization with the right permission", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_OWNER" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "HOA", status: "active" });

    const { requireArchitecturalRequestDecide } = await import("../architectural-requests-guard");
    await expect(requireArchitecturalRequestDecide()).resolves.toMatchObject({ organizationId: "org-a", role: "ORG_OWNER" });
  });

  it("propagates a permission denial from requirePermission itself without ever checking the org", async () => {
    requirePermission.mockRejectedValueOnce(new Error("Forbidden"));
    const { requireArchitecturalRequestWrite } = await import("../architectural-requests-guard");

    await expect(requireArchitecturalRequestWrite()).rejects.toThrow("Forbidden");
    expect(findUniqueOrganization).not.toHaveBeenCalled();
  });
});

describe("getArchitecturalRequestAccessContext", () => {
  it("resolves a request scoped to the caller's organization", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", organizationId: "org-a" });
    const { getArchitecturalRequestAccessContext } = await import("../architectural-requests-guard");

    const ctx = await getArchitecturalRequestAccessContext("org-a", "request-1", "STAFF");
    expect(ctx.request.id).toBe("request-1");
    expect(findFirstArchitecturalRequest).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "request-1", organizationId: "org-a" } }));
  });

  it("treats a cross-tenant request id as not found, never leaking existence", async () => {
    findFirstArchitecturalRequest.mockResolvedValueOnce(null);
    const { getArchitecturalRequestAccessContext } = await import("../architectural-requests-guard");

    await expect(getArchitecturalRequestAccessContext("org-a", "request-from-other-org", "STAFF")).rejects.toMatchObject({
      code: "HOA_ARCHITECTURAL_REQUEST_NOT_FOUND",
    });
  });
});

describe("requireArchitecturalRequestSubmissionEligibility", () => {
  it("grants eligibility when the query's relationshipType filter matches (OWNER, CO_OWNER, or NON_RESIDENT_OWNER) and queries for exactly those three types", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstPropertyResident.mockResolvedValueOnce({ id: "resident-rel-1" });

    const { requireArchitecturalRequestSubmissionEligibility } = await import("../architectural-requests-guard");
    const result = await requireArchitecturalRequestSubmissionEligibility("org-a", "prop-1");

    expect(result.memberId).toBe("member-1");
    expect(findFirstPropertyResident).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          propertyId: "prop-1",
          orgMemberId: "member-1",
          status: "ACTIVE",
          relationshipType: { in: ["OWNER", "CO_OWNER", "NON_RESIDENT_OWNER"] },
        }),
      })
    );
  });

  it("denies a RESIDENT relationship -- not eligible to self-submit in this MVP", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstPropertyResident.mockResolvedValueOnce(null); // the real query already excludes RESIDENT via relationshipType filter

    const { requireArchitecturalRequestSubmissionEligibility } = await import("../architectural-requests-guard");
    await expect(requireArchitecturalRequestSubmissionEligibility("org-a", "prop-1")).rejects.toMatchObject({
      code: "HOA_ARCHITECTURAL_REQUEST_INELIGIBLE_RELATIONSHIP",
    });
  });

  it("denies a TENANT relationship -- not eligible to self-submit in this MVP", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstPropertyResident.mockResolvedValueOnce(null);

    const { requireArchitecturalRequestSubmissionEligibility } = await import("../architectural-requests-guard");
    await expect(requireArchitecturalRequestSubmissionEligibility("org-a", "prop-1")).rejects.toMatchObject({
      code: "HOA_ARCHITECTURAL_REQUEST_INELIGIBLE_RELATIONSHIP",
    });
  });

  it("denies a caller with no relationship to the property at all", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstPropertyResident.mockResolvedValueOnce(null);

    const { requireArchitecturalRequestSubmissionEligibility } = await import("../architectural-requests-guard");
    await expect(requireArchitecturalRequestSubmissionEligibility("org-a", "prop-1")).rejects.toMatchObject({
      code: "HOA_ARCHITECTURAL_REQUEST_INELIGIBLE_RELATIONSHIP",
    });
  });

  it("never trusts a memberId from anywhere but the caller's own authenticated session", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstPropertyResident.mockResolvedValueOnce(null);

    const { requireArchitecturalRequestSubmissionEligibility } = await import("../architectural-requests-guard");
    await expect(requireArchitecturalRequestSubmissionEligibility("org-a", "prop-1")).rejects.toMatchObject({
      code: "HOA_ARCHITECTURAL_REQUEST_INELIGIBLE_RELATIONSHIP",
    });
    expect(findFirstPropertyResident).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgMemberId: "member-1" }) }));
  });
});

describe("requireArchitecturalRequestResidentAccess", () => {
  it("grants access to the caller's own submitted request", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", submittedByOrgMemberId: "member-1" });

    const { requireArchitecturalRequestResidentAccess } = await import("../architectural-requests-guard");
    const result = await requireArchitecturalRequestResidentAccess("org-a", "request-1");

    expect(result.memberId).toBe("member-1");
  });

  it("denies a request submitted by a different member -- never trusts anything but the caller's own session", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", submittedByOrgMemberId: "someone-elses-member-id" });

    const { requireArchitecturalRequestResidentAccess } = await import("../architectural-requests-guard");
    await expect(requireArchitecturalRequestResidentAccess("org-a", "request-1")).rejects.toMatchObject({ code: "HOA_ARCHITECTURAL_REQUEST_NOT_YOURS" });
  });

  it("treats a cross-tenant request id as not found", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstArchitecturalRequest.mockResolvedValueOnce(null);

    const { requireArchitecturalRequestResidentAccess } = await import("../architectural-requests-guard");
    await expect(requireArchitecturalRequestResidentAccess("org-a", "request-from-other-org")).rejects.toMatchObject({
      code: "HOA_ARCHITECTURAL_REQUEST_NOT_FOUND",
    });
  });

  it("still grants access to the submitter's own DRAFT request -- unlike Violations, a resident's own draft is not hidden from them", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstArchitecturalRequest.mockResolvedValueOnce({ id: "request-1", status: "DRAFT", submittedByOrgMemberId: "member-1" });

    const { requireArchitecturalRequestResidentAccess } = await import("../architectural-requests-guard");
    await expect(requireArchitecturalRequestResidentAccess("org-a", "request-1")).resolves.toMatchObject({ memberId: "member-1" });
  });
});

describe("listMyArchitecturalRequests / listMyEligibleSubmissionProperties", () => {
  it("scopes listMyArchitecturalRequests to the caller's own submissions only", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findManyArchitecturalRequest.mockResolvedValueOnce([{ id: "request-1" }]);

    const { listMyArchitecturalRequests } = await import("../architectural-requests-guard");
    await listMyArchitecturalRequests("org-a");

    expect(findManyArchitecturalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ submittedByOrgMemberId: "member-1" }) })
    );
  });

  it("scopes listMyEligibleSubmissionProperties to ACTIVE + eligible-relationship-type rows only", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findManyPropertyResident.mockResolvedValueOnce([{ propertyId: "prop-1" }]);

    const { listMyEligibleSubmissionProperties } = await import("../architectural-requests-guard");
    const result = await listMyEligibleSubmissionProperties("org-a");

    expect(result.propertyIds).toEqual(["prop-1"]);
    expect(findManyPropertyResident).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgMemberId: "member-1", status: "ACTIVE", relationshipType: { in: ["OWNER", "CO_OWNER", "NON_RESIDENT_OWNER"] } }),
      })
    );
  });
});
