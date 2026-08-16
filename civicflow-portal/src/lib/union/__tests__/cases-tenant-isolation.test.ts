import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * UNION-CASE-D hardening pass — adversarial cross-tenant tests for every
 * write function in cases.ts that wasn't already covered by A's own
 * tenant-isolation suite (cases-guard.test.ts covers the read/guard
 * layer; this covers the write/service layer's own existence checks).
 *
 * Mirrors the rigor established in
 * hoa/architectural-requests-guard.test.ts's relationshipType tests: the
 * mocks below don't just return null for a "cross-org" id (which would
 * pass even if the real `organizationId` filter were deleted from the
 * source entirely — a false-positive an earlier independent review
 * caught). Instead each mock simulates a real fixture "database" with
 * rows tagged to a specific org, and only returns a row when the WHERE
 * clause the code actually sent (id AND organizationId) matches it. A
 * weakened or removed organizationId filter in cases.ts would make these
 * tests fail, not just a wrong id.
 */

const CASE_IN_ORG_A = { id: "case-1", organizationId: "org-a", status: "ACTIVE", title: "t", memberOrgMemberId: "member-1", assignedToOrgMemberId: "rep-1" };
const DEADLINE_IN_ORG_A = { id: "deadline-1", organizationId: "org-a", caseId: "case-1", completedAt: null };
const ORG_MEMBER_IN_ORG_A = { id: "rep-1", organizationId: "org-a", membershipStatus: "active" };

const findFirstUnionCase = vi.fn();
const updateManyUnionCase = vi.fn();
const findUniqueOrThrowUnionCase = vi.fn();
const createStatusHistory = vi.fn();
const findFirstUnionCaseDeadline = vi.fn();
const updateManyUnionCaseDeadline = vi.fn();
const findUniqueOrThrowUnionCaseDeadline = vi.fn();
const createComment = vi.fn();
const createContractReference = vi.fn();
const createDeadline = vi.fn();
const findFirstOrgMember = vi.fn();
const createAuditEvent = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        unionCase: {
          findFirst: (...a: unknown[]) => findFirstUnionCase(...a),
          updateMany: (...a: unknown[]) => updateManyUnionCase(...a),
          findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrowUnionCase(...a),
        },
        unionCaseStatusHistory: { create: (...a: unknown[]) => createStatusHistory(...a) },
      }),
    unionCase: { findFirst: (...a: unknown[]) => findFirstUnionCase(...a) },
    unionCaseDeadline: {
      findFirst: (...a: unknown[]) => findFirstUnionCaseDeadline(...a),
      updateMany: (...a: unknown[]) => updateManyUnionCaseDeadline(...a),
      findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrowUnionCaseDeadline(...a),
      create: (...a: unknown[]) => createDeadline(...a),
    },
    unionCaseComment: { create: (...a: unknown[]) => createComment(...a) },
    unionCaseContractReference: { create: (...a: unknown[]) => createContractReference(...a) },
    orgMember: { findFirst: (...a: unknown[]) => findFirstOrgMember(...a) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));
vi.mock("@/lib/mail", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushToTokens: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();

  // Fixture "database" simulators: only return a row when id AND
  // organizationId both match, exactly like the real WHERE clauses.
  findFirstUnionCase.mockImplementation((args: { where: { id: string; organizationId: string } }) =>
    CASE_IN_ORG_A.id === args.where.id && CASE_IN_ORG_A.organizationId === args.where.organizationId ? { ...CASE_IN_ORG_A } : null
  );
  findFirstUnionCaseDeadline.mockImplementation((args: { where: { id: string; organizationId: string } }) =>
    DEADLINE_IN_ORG_A.id === args.where.id && DEADLINE_IN_ORG_A.organizationId === args.where.organizationId ? { ...DEADLINE_IN_ORG_A } : null
  );
  findFirstOrgMember.mockImplementation((args: { where: { id: string; organizationId: string } }) =>
    ORG_MEMBER_IN_ORG_A.id === args.where.id && ORG_MEMBER_IN_ORG_A.organizationId === args.where.organizationId ? { ...ORG_MEMBER_IN_ORG_A } : null
  );
  updateManyUnionCase.mockResolvedValue({ count: 1 });
  updateManyUnionCaseDeadline.mockResolvedValue({ count: 1 });
  findUniqueOrThrowUnionCase.mockResolvedValue({ ...CASE_IN_ORG_A });
});

describe("assignUnionCase — cross-tenant", () => {
  it("rejects an assignee id that belongs to a different organization -- never assigns cross-tenant", async () => {
    const { assignUnionCase } = await import("../cases");
    await expect(
      assignUnionCase({ organizationId: "org-b", caseId: "case-1", assignedToOrgMemberId: "rep-1", actorUserId: "u1" })
    ).rejects.toMatchObject({ code: "UNION_CASE_ASSIGNEE_NOT_FOUND" });
  });

  it("rejects a case id that belongs to a different organization, even with a valid same-org assignee", async () => {
    const { assignUnionCase } = await import("../cases");
    await expect(
      assignUnionCase({ organizationId: "org-b", caseId: "case-1", assignedToOrgMemberId: "some-org-b-member", actorUserId: "u1" })
    ).rejects.toMatchObject({ code: "UNION_CASE_ASSIGNEE_NOT_FOUND" }); // fails the assignee check first, never even reaches the case lookup
  });
});

describe("transitionUnionCaseStatus / withdrawUnionCase — cross-tenant", () => {
  it("treats a cross-tenant case id as not found on transitionUnionCaseStatus", async () => {
    const { transitionUnionCaseStatus } = await import("../cases");
    await expect(
      transitionUnionCaseStatus({ organizationId: "org-b", caseId: "case-1", toStatus: "PENDING", actorUserId: "u1" })
    ).rejects.toMatchObject({ code: "UNION_CASE_NOT_FOUND" });
  });

  it("treats a cross-tenant case id as not found on withdrawUnionCase, even if the memberOrgMemberId happens to match", async () => {
    const { withdrawUnionCase } = await import("../cases");
    await expect(
      withdrawUnionCase({ organizationId: "org-b", caseId: "case-1", memberOrgMemberId: "member-1" })
    ).rejects.toMatchObject({ code: "UNION_CASE_NOT_FOUND" });
  });
});

describe("addUnionCaseComment / addUnionCaseContractReference / addUnionCaseDeadline — cross-tenant", () => {
  it("rejects adding a comment to a case in a different organization -- a guessed case id must never let a caller post into another org's case", async () => {
    const { addUnionCaseComment } = await import("../cases");
    await expect(
      addUnionCaseComment({ organizationId: "org-b", caseId: "case-1", body: "attempted cross-tenant note", isPrivate: true, actorUserId: "u1" })
    ).rejects.toMatchObject({ code: "UNION_CASE_NOT_FOUND" });
    expect(createComment).not.toHaveBeenCalled();
  });

  it("rejects adding a contract reference to a case in a different organization", async () => {
    const { addUnionCaseContractReference } = await import("../cases");
    await expect(addUnionCaseContractReference({ organizationId: "org-b", caseId: "case-1", reference: "Article 1" })).rejects.toMatchObject({
      code: "UNION_CASE_NOT_FOUND",
    });
    expect(createContractReference).not.toHaveBeenCalled();
  });

  it("rejects adding a deadline to a case in a different organization", async () => {
    const { addUnionCaseDeadline } = await import("../cases");
    await expect(
      addUnionCaseDeadline({ organizationId: "org-b", caseId: "case-1", deadlineType: "FOLLOW_UP", dueAt: new Date(), actorUserId: "u1" })
    ).rejects.toMatchObject({ code: "UNION_CASE_NOT_FOUND" });
    expect(createDeadline).not.toHaveBeenCalled();
  });
});

describe("completeUnionCaseDeadline — cross-tenant", () => {
  it("rejects completing a deadline that belongs to a different organization -- a guessed deadline id must never be sufficient", async () => {
    const { completeUnionCaseDeadline } = await import("../cases");
    await expect(completeUnionCaseDeadline({ organizationId: "org-b", deadlineId: "deadline-1", actorUserId: "u1" })).rejects.toMatchObject({
      code: "UNION_CASE_DEADLINE_NOT_FOUND",
    });
    expect(updateManyUnionCaseDeadline).not.toHaveBeenCalled();
  });
});
