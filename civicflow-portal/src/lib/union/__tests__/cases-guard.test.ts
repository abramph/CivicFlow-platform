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
const findFirstUnionCase = vi.fn();
const findFirstOrgMember = vi.fn();
const findManyUnionCase = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    unionCase: {
      findFirst: (...a: unknown[]) => findFirstUnionCase(...a),
      findMany: (...a: unknown[]) => findManyUnionCase(...a),
    },
    orgMember: { findFirst: (...a: unknown[]) => findFirstOrgMember(...a) },
  },
}));

beforeEach(async () => {
  vi.clearAllMocks();
  const actual = await vi.importActual<typeof import("@/lib/vertical-capabilities")>("@/lib/vertical-capabilities");
  hasVerticalCapability.mockImplementation(actual.hasVerticalCapability);
});

describe("staff permission gates (requireUnionCase{Read,Manage,NotesInternal,DeadlinesManage,Close})", () => {
  it("denies when the organization isn't UNION vertical, even with the right permission -- a UNION organizationType string alone is never sufficient", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_OWNER" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY", status: "active" });

    const { requireUnionCaseRead } = await import("../cases-guard");
    await expect(requireUnionCaseRead()).rejects.toMatchObject({ code: "UNION_CASE_MANAGEMENT_NOT_ENABLED" });
  });

  it("denies a genuinely-UNION organization whose 'caseManagement' capability flag is off", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_OWNER" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "UNION", status: "active" });
    hasVerticalCapability.mockImplementation((_vertical: string, flag: string) => flag !== "caseManagement");

    const { requireUnionCaseRead } = await import("../cases-guard");
    await expect(requireUnionCaseRead()).rejects.toMatchObject({ code: "UNION_CASE_MANAGEMENT_NOT_ENABLED" });
  });

  it("denies a suspended UNION organization even with the capability on", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_OWNER" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "UNION", status: "suspended" });

    const { requireUnionCaseRead } = await import("../cases-guard");
    await expect(requireUnionCaseRead()).rejects.toMatchObject({ code: "UNION_ORGANIZATION_INACTIVE" });
  });

  it("succeeds for an active UNION organization with the right permission", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1" }, role: "ORG_OWNER" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "UNION", status: "active" });

    const { requireUnionCaseClose } = await import("../cases-guard");
    await expect(requireUnionCaseClose()).resolves.toMatchObject({ organizationId: "org-a", role: "ORG_OWNER" });
  });

  it("propagates a permission denial from requirePermission itself without ever checking the org (STAFF holding UNION_CASES_READ but not UNION_CASES_CLOSE)", async () => {
    requirePermission.mockRejectedValueOnce(new Error("Forbidden"));
    const { requireUnionCaseClose } = await import("../cases-guard");

    await expect(requireUnionCaseClose()).rejects.toThrow("Forbidden");
    expect(findUniqueOrganization).not.toHaveBeenCalled();
  });
});

describe("getUnionCaseAccessContext -- tenant isolation", () => {
  it("resolves a case scoped to the caller's organization", async () => {
    findFirstUnionCase.mockResolvedValueOnce({ id: "case-1" });
    const { getUnionCaseAccessContext } = await import("../cases-guard");

    const ctx = await getUnionCaseAccessContext("org-a", "case-1", "STAFF");
    expect(ctx.caseId).toBe("case-1");
    expect(findFirstUnionCase).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "case-1", organizationId: "org-a" } }));
  });

  it("treats a cross-tenant case id as not found, never leaking whether it exists elsewhere -- a guessed UUID must never be sufficient", async () => {
    findFirstUnionCase.mockResolvedValueOnce(null);
    const { getUnionCaseAccessContext } = await import("../cases-guard");

    await expect(getUnionCaseAccessContext("org-a", "case-from-other-org", "STAFF")).rejects.toMatchObject({ code: "UNION_CASE_NOT_FOUND" });
  });
});

describe("requireUnionCaseSubmitterAccess", () => {
  it("grants submission access to an active member of a case-management-enabled org", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "UNION", status: "active" });
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1" });

    const { requireUnionCaseSubmitterAccess } = await import("../cases-guard");
    const result = await requireUnionCaseSubmitterAccess("org-a");
    expect(result.memberId).toBe("member-1");
  });

  it("denies a member whose membership isn't active, even with a valid web session -- a MEMBER web session can outlive an active membership", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "UNION", status: "active" });
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstOrgMember.mockImplementationOnce((args: { where: { membershipStatus?: string } }) =>
      args.where.membershipStatus === "active" ? null : { id: "member-1" }
    );

    const { requireUnionCaseSubmitterAccess } = await import("../cases-guard");
    await expect(requireUnionCaseSubmitterAccess("org-a")).rejects.toMatchObject({ code: "UNION_CASE_MEMBER_NOT_ACTIVE" });
  });

  it("denies submission before even checking membership when case management isn't enabled for the org", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY", status: "active" });

    const { requireUnionCaseSubmitterAccess } = await import("../cases-guard");
    await expect(requireUnionCaseSubmitterAccess("org-a")).rejects.toMatchObject({ code: "UNION_CASE_MANAGEMENT_NOT_ENABLED" });
    expect(requireMemberWebSession).not.toHaveBeenCalled();
  });
});

describe("requireUnionCaseMemberAccess -- tenant isolation + ownership", () => {
  it("grants access to the caller's own case", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstUnionCase.mockResolvedValueOnce({ id: "case-1", memberOrgMemberId: "member-1" });

    const { requireUnionCaseMemberAccess } = await import("../cases-guard");
    const result = await requireUnionCaseMemberAccess("org-a", "case-1");
    expect(result.memberId).toBe("member-1");
  });

  it("denies a case that belongs to a different member in the SAME organization -- never trusts anything but the caller's own session", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstUnionCase.mockResolvedValueOnce({ id: "case-1", memberOrgMemberId: "some-other-members-id" });

    const { requireUnionCaseMemberAccess } = await import("../cases-guard");
    await expect(requireUnionCaseMemberAccess("org-a", "case-1")).rejects.toMatchObject({ code: "UNION_CASE_NOT_YOURS" });
  });

  it("treats a cross-tenant case id as not found -- a member of org-a guessing a case id from org-b gets NOT_FOUND, not NOT_YOURS (never confirms the id exists elsewhere)", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findFirstUnionCase.mockResolvedValueOnce(null);

    const { requireUnionCaseMemberAccess } = await import("../cases-guard");
    await expect(requireUnionCaseMemberAccess("org-a", "case-from-other-org")).rejects.toMatchObject({ code: "UNION_CASE_NOT_FOUND" });
    expect(findFirstUnionCase).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "case-from-other-org", organizationId: "org-a" } }));
  });
});

describe("listMyUnionCases", () => {
  it("scopes to the caller's own organizationId + memberOrgMemberId only -- never accepts a memberId from client input", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ memberId: "member-1", organizationId: "org-a" });
    findManyUnionCase.mockResolvedValueOnce([{ id: "case-1" }]);

    const { listMyUnionCases } = await import("../cases-guard");
    await listMyUnionCases("org-a");

    expect(findManyUnionCase).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", memberOrgMemberId: "member-1" } })
    );
  });
});
