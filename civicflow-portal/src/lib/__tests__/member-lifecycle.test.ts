import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstOrgMember = vi.fn();
const updateManyOrgMember = vi.fn();
const findUniqueOrThrowOrgMember = vi.fn();
const findManyOrganizationMembership = vi.fn();
const updateOrganizationMembership = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);
const createMemberTimelineEvent = vi.fn().mockResolvedValue(undefined);
const sendPushToMember = vi.fn().mockResolvedValue(undefined);

const txClient = {
  orgMember: {
    findFirst: (...a: unknown[]) => findFirstOrgMember(...a),
    updateMany: (...a: unknown[]) => updateManyOrgMember(...a),
    findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrowOrgMember(...a),
  },
  organizationMembership: {
    findMany: (...a: unknown[]) => findManyOrganizationMembership(...a),
    update: (...a: unknown[]) => updateOrganizationMembership(...a),
  },
};
const transaction = vi.fn((fn: (tx: typeof txClient) => unknown) => fn(txClient));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...a: Parameters<typeof transaction>) => transaction(...a),
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));
vi.mock("@/lib/member-timeline", () => ({ createMemberTimelineEvent: (...a: unknown[]) => createMemberTimelineEvent(...a) }));
vi.mock("@/lib/push", () => ({ sendPushToMember: (...a: unknown[]) => sendPushToMember(...a) }));

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation((fn: (tx: typeof txClient) => unknown) => fn(txClient));
  updateManyOrgMember.mockResolvedValue({ count: 1 });
  findManyOrganizationMembership.mockResolvedValue([]);
});

function member(overrides: Partial<{ id: string; organizationId: string; userId: string | null; membershipStatus: string }> = {}) {
  return {
    id: "member-1",
    organizationId: "org-a",
    userId: null,
    membershipStatus: "active",
    ...overrides,
  };
}

const baseTerminateInput = {
  organizationId: "org-a",
  memberId: "member-1",
  actorUserId: "user-staff",
  reasonCode: "RESIGNED_VOLUNTARY",
  effectiveDate: "2026-08-01",
};

describe("terminateMember", () => {
  it("terminates an active member and writes audit + timeline events", async () => {
    findFirstOrgMember.mockResolvedValueOnce(member());
    findUniqueOrThrowOrgMember.mockResolvedValueOnce(member({ membershipStatus: "terminated" }));
    const { terminateMember } = await import("../member-lifecycle");

    const result = await terminateMember(baseTerminateInput);

    expect(result.membershipStatus).toBe("terminated");
    expect(updateManyOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "member-1", membershipStatus: { not: "terminated" } }) })
    );
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "terminate", entityId: "member-1" }));
    expect(createMemberTimelineEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "TERMINATED" }));
  });

  it("rejects with MEMBER_NOT_FOUND when the member doesn't exist in this org", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null);
    const { terminateMember } = await import("../member-lifecycle");

    await expect(terminateMember(baseTerminateInput)).rejects.toMatchObject({ code: "MEMBER_NOT_FOUND" });
  });

  it("rejects with MEMBER_ALREADY_TERMINATED when already terminated", async () => {
    findFirstOrgMember.mockResolvedValueOnce(member({ membershipStatus: "terminated" }));
    const { terminateMember } = await import("../member-lifecycle");

    await expect(terminateMember(baseTerminateInput)).rejects.toMatchObject({ code: "MEMBER_ALREADY_TERMINATED" });
  });

  it("rejects with MEMBER_ALREADY_TERMINATED when the compare-and-swap loses a race", async () => {
    findFirstOrgMember.mockResolvedValueOnce(member());
    updateManyOrgMember.mockResolvedValueOnce({ count: 0 });
    const { terminateMember } = await import("../member-lifecycle");

    await expect(terminateMember(baseTerminateInput)).rejects.toMatchObject({ code: "MEMBER_ALREADY_TERMINATED" });
  });

  it("rejects with TERMINATION_REASON_REQUIRED when reasonCode is missing", async () => {
    const { terminateMember } = await import("../member-lifecycle");
    await expect(terminateMember({ ...baseTerminateInput, reasonCode: undefined })).rejects.toMatchObject({
      code: "TERMINATION_REASON_REQUIRED",
    });
  });

  it('rejects with TERMINATION_REASON_REQUIRED when reasonCode is "OTHER" with no free text', async () => {
    const { terminateMember } = await import("../member-lifecycle");
    await expect(terminateMember({ ...baseTerminateInput, reasonCode: "OTHER", reasonOther: "  " })).rejects.toMatchObject({
      code: "TERMINATION_REASON_REQUIRED",
    });
  });

  it('accepts reasonCode "OTHER" with free text', async () => {
    findFirstOrgMember.mockResolvedValueOnce(member());
    findUniqueOrThrowOrgMember.mockResolvedValueOnce(member({ membershipStatus: "terminated" }));
    const { terminateMember } = await import("../member-lifecycle");

    await expect(
      terminateMember({ ...baseTerminateInput, reasonCode: "OTHER", reasonOther: "Custom situation" })
    ).resolves.toBeDefined();
  });

  it("rejects with INVALID_EFFECTIVE_DATE when the date is missing or unparseable", async () => {
    const { terminateMember } = await import("../member-lifecycle");
    await expect(terminateMember({ ...baseTerminateInput, effectiveDate: undefined })).rejects.toMatchObject({
      code: "INVALID_EFFECTIVE_DATE",
    });
    await expect(terminateMember({ ...baseTerminateInput, effectiveDate: "not-a-date" })).rejects.toMatchObject({
      code: "INVALID_EFFECTIVE_DATE",
    });
  });

  it("rejects with INVALID_EFFECTIVE_DATE when more than 5 years away", async () => {
    const { terminateMember } = await import("../member-lifecycle");
    await expect(terminateMember({ ...baseTerminateInput, effectiveDate: "2040-01-01" })).rejects.toMatchObject({
      code: "INVALID_EFFECTIVE_DATE",
    });
  });

  it("suspends the linked OrganizationMembership when the member has app login access in this org", async () => {
    findFirstOrgMember.mockResolvedValueOnce(member({ userId: "user-linked" }));
    findManyOrganizationMembership.mockResolvedValueOnce([
      { id: "membership-1", userId: "user-linked", role: "STAFF" },
    ]);
    findUniqueOrThrowOrgMember.mockResolvedValueOnce(member({ userId: "user-linked", membershipStatus: "terminated" }));
    const { terminateMember } = await import("../member-lifecycle");

    await terminateMember({ ...baseTerminateInput, actorUserId: "user-staff" });

    expect(updateOrganizationMembership).toHaveBeenCalledWith({ where: { id: "membership-1" }, data: { status: "suspended" } });
  });

  it("does not touch OrganizationMembership when the member has no linked login", async () => {
    findFirstOrgMember.mockResolvedValueOnce(member({ userId: null }));
    findUniqueOrThrowOrgMember.mockResolvedValueOnce(member({ membershipStatus: "terminated" }));
    const { terminateMember } = await import("../member-lifecycle");

    await terminateMember(baseTerminateInput);

    expect(findManyOrganizationMembership).not.toHaveBeenCalled();
    expect(updateOrganizationMembership).not.toHaveBeenCalled();
  });

  it("rejects with LAST_OWNER_CANNOT_BE_TERMINATED when this is the sole active owner", async () => {
    findFirstOrgMember.mockResolvedValueOnce(member({ userId: "user-owner" }));
    findManyOrganizationMembership.mockResolvedValueOnce([
      { id: "membership-owner", userId: "user-owner", role: "ORG_OWNER" },
    ]);
    const { terminateMember } = await import("../member-lifecycle");

    await expect(terminateMember({ ...baseTerminateInput, memberId: "member-1" })).rejects.toMatchObject({
      code: "LAST_OWNER_CANNOT_BE_TERMINATED",
    });
    expect(updateManyOrgMember).not.toHaveBeenCalled();
  });

  it("allows terminating an owner when another active owner exists", async () => {
    findFirstOrgMember.mockResolvedValueOnce(member({ userId: "user-owner-1" }));
    findManyOrganizationMembership.mockResolvedValueOnce([
      { id: "membership-owner-1", userId: "user-owner-1", role: "ORG_OWNER" },
      { id: "membership-owner-2", userId: "user-owner-2", role: "ORG_OWNER" },
    ]);
    findUniqueOrThrowOrgMember.mockResolvedValueOnce(member({ userId: "user-owner-1", membershipStatus: "terminated" }));
    const { terminateMember } = await import("../member-lifecycle");

    await expect(terminateMember(baseTerminateInput)).resolves.toBeDefined();
    expect(updateOrganizationMembership).toHaveBeenCalledWith({ where: { id: "membership-owner-1" }, data: { status: "suspended" } });
  });

  it("does not block termination when the linked login holds a non-owner role, even if it's the only active membership", async () => {
    findFirstOrgMember.mockResolvedValueOnce(member({ userId: "user-staff-2" }));
    findManyOrganizationMembership.mockResolvedValueOnce([
      { id: "membership-staff", userId: "user-staff-2", role: "STAFF" },
    ]);
    findUniqueOrThrowOrgMember.mockResolvedValueOnce(member({ userId: "user-staff-2", membershipStatus: "terminated" }));
    const { terminateMember } = await import("../member-lifecycle");

    await expect(terminateMember(baseTerminateInput)).resolves.toBeDefined();
  });
});

const baseReinstateInput = {
  organizationId: "org-a",
  memberId: "member-1",
  actorUserId: "user-staff",
  reason: "Paid outstanding balance and requested to rejoin",
  effectiveDate: "2026-08-01",
};

describe("reinstateMember", () => {
  it("reinstates a terminated member back to active", async () => {
    findFirstOrgMember.mockResolvedValueOnce(member({ membershipStatus: "terminated" }));
    findUniqueOrThrowOrgMember.mockResolvedValueOnce(member({ membershipStatus: "active" }));
    const { reinstateMember } = await import("../member-lifecycle");

    const result = await reinstateMember(baseReinstateInput);

    expect(result.membershipStatus).toBe("active");
    expect(createMemberTimelineEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "REACTIVATED" }));
  });

  it("rejects with MEMBER_NOT_TERMINATED when the member is not currently terminated", async () => {
    findFirstOrgMember.mockResolvedValueOnce(member({ membershipStatus: "active" }));
    const { reinstateMember } = await import("../member-lifecycle");

    await expect(reinstateMember(baseReinstateInput)).rejects.toMatchObject({ code: "MEMBER_NOT_TERMINATED" });
  });

  it("rejects with MEMBER_NOT_TERMINATED when the compare-and-swap loses a race", async () => {
    findFirstOrgMember.mockResolvedValueOnce(member({ membershipStatus: "terminated" }));
    updateManyOrgMember.mockResolvedValueOnce({ count: 0 });
    const { reinstateMember } = await import("../member-lifecycle");

    await expect(reinstateMember(baseReinstateInput)).rejects.toMatchObject({ code: "MEMBER_NOT_TERMINATED" });
  });

  it("rejects with REINSTATEMENT_REASON_REQUIRED when reason is blank", async () => {
    const { reinstateMember } = await import("../member-lifecycle");
    await expect(reinstateMember({ ...baseReinstateInput, reason: "   " })).rejects.toMatchObject({
      code: "REINSTATEMENT_REASON_REQUIRED",
    });
  });

  it("does not touch OrganizationMembership on reinstate (access restoration is a separate, explicit action)", async () => {
    findFirstOrgMember.mockResolvedValueOnce(member({ membershipStatus: "terminated", userId: "user-linked" }));
    findUniqueOrThrowOrgMember.mockResolvedValueOnce(member({ membershipStatus: "active", userId: "user-linked" }));
    const { reinstateMember } = await import("../member-lifecycle");

    await reinstateMember(baseReinstateInput);

    expect(findManyOrganizationMembership).not.toHaveBeenCalled();
    expect(updateOrganizationMembership).not.toHaveBeenCalled();
  });
});
