import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * MEMBER-QR-G — review.ts. Covers the read side (listSubmissions filters,
 * getSubmissionDetail's field-level diff against matched/candidate members)
 * and the write side's compare-and-swap discipline: approve/reject/link/
 * create-new each claim a submission via their own CAS before handing off to
 * applySubmission() (mocked here — its own behavior is covered by
 * update-engine.test.ts), and each requires an authenticated admin actor.
 */

const findManySubmission = vi.fn();
const findFirstSubmission = vi.fn();
const updateManySubmission = vi.fn();
const findManyOrgMember = vi.fn();
const findFirstOrgMember = vi.fn();
const createAuditEvent = vi.fn();
const applySubmission = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    memberIntakeSubmission: {
      findMany: (...a: unknown[]) => findManySubmission(...a),
      findFirst: (...a: unknown[]) => findFirstSubmission(...a),
      updateMany: (...a: unknown[]) => updateManySubmission(...a),
    },
    orgMember: {
      findMany: (...a: unknown[]) => findManyOrgMember(...a),
      findFirst: (...a: unknown[]) => findFirstOrgMember(...a),
    },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));
vi.mock("../update-engine", () => ({ applySubmission: (...a: unknown[]) => applySubmission(...a) }));

beforeEach(() => {
  vi.clearAllMocks();
  updateManySubmission.mockResolvedValue({ count: 1 });
  applySubmission.mockResolvedValue({ status: "APPLIED", memberId: "m-1", appliedFieldCount: 1 });
});

const ACTOR = { userId: "admin-1", userEmail: "admin@example.com" };

function field(overrides: Partial<{ fieldKey: string; targetField: string; sensitivity: "LOW" | "MODERATE" | "HIGH" }>) {
  return {
    id: `f-${overrides.fieldKey}`,
    formId: "form-1",
    fieldKey: overrides.fieldKey,
    label: overrides.fieldKey,
    fieldType: "TEXT",
    required: false,
    order: 0,
    options: [],
    targetEntity: "MEMBER",
    targetField: overrides.targetField,
    sensitivity: overrides.sensitivity,
    isCustomField: false,
  };
}

describe("listSubmissions", () => {
  it("scopes the query to the organization and applies the requested filter", async () => {
    findManySubmission.mockResolvedValue([]);
    const { listSubmissions } = await import("../review");
    await listSubmissions("org-a", { filter: "POSSIBLE_DUPLICATES" });
    const call = findManySubmission.mock.calls[0][0];
    expect(call.where.organizationId).toBe("org-a");
    expect(call.where.status).toBe("REVIEW_REQUIRED");
    expect(call.where.candidateMemberIds).toEqual({ isEmpty: false });
  });

  it("summarizes the submitter from name, falling back to email then phone", async () => {
    findManySubmission.mockResolvedValue([
      {
        id: "sub-1",
        status: "REVIEW_REQUIRED",
        submittedAt: new Date(),
        fieldValues: { email: "a@example.com" },
        matchedMemberId: null,
        candidateMemberIds: [],
        matchConfidence: null,
        matchMethod: null,
        verificationStatus: "NOT_REQUIRED",
        appliedAt: null,
        form: { id: "form-1", name: "Join Us", purpose: "NEW_MEMBER" },
        source: null,
      },
    ]);
    const { listSubmissions } = await import("../review");
    const { submissions } = await listSubmissions("org-a");
    expect(submissions[0].submitter).toBe("a@example.com");
  });
});

describe("getSubmissionDetail", () => {
  it("throws MEMBER_INTAKE_SUBMISSION_NOT_FOUND when the submission doesn't exist in this org", async () => {
    findFirstSubmission.mockResolvedValue(null);
    const { getSubmissionDetail } = await import("../review");
    await expect(getSubmissionDetail("org-a", "sub-1")).rejects.toMatchObject({ code: "MEMBER_INTAKE_SUBMISSION_NOT_FOUND" });
  });

  it("computes a field-level diff against the matched member, marking only actually-changed fields", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      organizationId: "org-a",
      formId: "form-1",
      status: "REVIEW_REQUIRED",
      submittedAt: new Date(),
      fieldValues: { phone: "+12155559999", preferredName: "Robert" },
      matchedMemberId: "m-1",
      candidateMemberIds: [],
      matchConfidence: 100,
      matchMethod: "exact_email",
      verificationStatus: "NOT_REQUIRED",
      reviewedByUserId: null,
      reviewedAt: null,
      createdMemberId: null,
      appliedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      form: {
        name: "Join Us",
        fields: [
          field({ fieldKey: "phone", targetField: "phone", sensitivity: "MODERATE" }),
          field({ fieldKey: "preferredName", targetField: "preferredName", sensitivity: "LOW" }),
        ],
      },
    });
    findManyOrgMember.mockResolvedValue([
      { id: "m-1", firstName: "Bob", lastName: "Smith", email: "bob@example.com", phone: "+12155551111", membershipStatus: "active", preferredName: "Robert" },
    ]);

    const { getSubmissionDetail } = await import("../review");
    const detail = await getSubmissionDetail("org-a", "sub-1");

    const diff = detail.diffByMemberId["m-1"];
    const phoneDiff = diff.find((d) => d.fieldKey === "phone")!;
    const nameDiff = diff.find((d) => d.fieldKey === "preferredName")!;
    expect(phoneDiff.changed).toBe(true);
    expect(phoneDiff.previousValue).toBe("+12155551111");
    expect(phoneDiff.newValue).toBe("+12155559999");
    expect(nameDiff.changed).toBe(false); // "Robert" submitted, "Robert" already on file
    expect(detail.matchedMember?.id).toBe("m-1");
  });
});

describe("approveSubmission", () => {
  it("requires an authenticated admin actor", async () => {
    const { approveSubmission } = await import("../review");
    await expect(approveSubmission("org-a", "sub-1", { userId: null, userEmail: null })).rejects.toMatchObject({
      code: "MEMBER_INTAKE_INVALID_STATUS_TRANSITION",
    });
    expect(updateManySubmission).not.toHaveBeenCalled();
  });

  it("claims a REVIEW_REQUIRED submission via CAS, audits, then hands off to applySubmission", async () => {
    findFirstSubmission.mockResolvedValue({ id: "sub-1", status: "REVIEW_REQUIRED", matchedMemberId: "m-1" });
    const { approveSubmission } = await import("../review");
    const result = await approveSubmission("org-a", "sub-1", ACTOR);

    expect(updateManySubmission).toHaveBeenCalledWith({
      where: { id: "sub-1", status: "REVIEW_REQUIRED" },
      data: expect.objectContaining({ status: "APPROVED", reviewedByUserId: "admin-1" }),
    });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "approve", metadata: expect.objectContaining({ bypassedVerification: false }) }));
    expect(applySubmission).toHaveBeenCalledWith("org-a", "sub-1", ACTOR);
    expect(result.status).toBe("APPLIED");
  });

  it("flags bypassedVerification in the audit event when approving a stuck VERIFICATION_REQUIRED submission", async () => {
    findFirstSubmission.mockResolvedValue({ id: "sub-1", status: "VERIFICATION_REQUIRED", matchedMemberId: "m-1" });
    const { approveSubmission } = await import("../review");
    await approveSubmission("org-a", "sub-1", ACTOR);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ bypassedVerification: true }) }));
  });

  it("refuses to approve a submission that isn't in a reviewable status", async () => {
    findFirstSubmission.mockResolvedValue({ id: "sub-1", status: "APPLIED", matchedMemberId: "m-1" });
    const { approveSubmission } = await import("../review");
    await expect(approveSubmission("org-a", "sub-1", ACTOR)).rejects.toMatchObject({ code: "MEMBER_INTAKE_INVALID_STATUS_TRANSITION" });
    expect(updateManySubmission).not.toHaveBeenCalled();
  });

  it("fails fast when a concurrent reviewer already claimed the submission (CAS count: 0)", async () => {
    findFirstSubmission.mockResolvedValue({ id: "sub-1", status: "REVIEW_REQUIRED", matchedMemberId: "m-1" });
    updateManySubmission.mockResolvedValue({ count: 0 });
    const { approveSubmission } = await import("../review");
    await expect(approveSubmission("org-a", "sub-1", ACTOR)).rejects.toMatchObject({ code: "MEMBER_INTAKE_INVALID_STATUS_TRANSITION" });
    expect(applySubmission).not.toHaveBeenCalled();
  });
});

describe("rejectSubmission", () => {
  it("rejects from REVIEW_REQUIRED, stamping rejection fields and auditing", async () => {
    findFirstSubmission.mockResolvedValue({ id: "sub-1", status: "REVIEW_REQUIRED" });
    const { rejectSubmission } = await import("../review");
    await rejectSubmission("org-a", "sub-1", ACTOR, "Not a real person");
    expect(updateManySubmission).toHaveBeenCalledWith({
      where: { id: "sub-1", status: "REVIEW_REQUIRED" },
      data: expect.objectContaining({ status: "REJECTED", rejectionReason: "Not a real person", reviewedByUserId: "admin-1" }),
    });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "reject" }));
    expect(applySubmission).not.toHaveBeenCalled();
  });

  it("refuses to reject an already-applied submission", async () => {
    findFirstSubmission.mockResolvedValue({ id: "sub-1", status: "APPLIED" });
    const { rejectSubmission } = await import("../review");
    await expect(rejectSubmission("org-a", "sub-1", ACTOR, "too late")).rejects.toMatchObject({ code: "MEMBER_INTAKE_INVALID_STATUS_TRANSITION" });
  });
});

describe("linkSubmissionToMember", () => {
  it("refuses to link to a member outside the organization", async () => {
    findFirstOrgMember.mockResolvedValue(null);
    const { linkSubmissionToMember } = await import("../review");
    await expect(linkSubmissionToMember("org-a", "sub-1", "m-from-other-org", ACTOR)).rejects.toMatchObject({ code: "MEMBER_INTAKE_SUBMISSION_NOT_FOUND" });
    expect(updateManySubmission).not.toHaveBeenCalled();
  });

  it("stamps matchedMemberId via CAS, audits, and applies", async () => {
    findFirstOrgMember.mockResolvedValue({ id: "m-2", organizationId: "org-a" });
    findFirstSubmission.mockResolvedValue({ id: "sub-1", status: "REVIEW_REQUIRED" });
    const { linkSubmissionToMember } = await import("../review");
    await linkSubmissionToMember("org-a", "sub-1", "m-2", ACTOR);
    expect(updateManySubmission).toHaveBeenCalledWith({
      where: { id: "sub-1", status: "REVIEW_REQUIRED" },
      data: expect.objectContaining({ matchedMemberId: "m-2" }),
    });
    expect(applySubmission).toHaveBeenCalledWith("org-a", "sub-1", ACTOR);
  });
});

describe("createNewMemberFromSubmission", () => {
  it("clears matchedMemberId via CAS before applying, so applySubmission takes the create path", async () => {
    findFirstSubmission.mockResolvedValue({ id: "sub-1", status: "REVIEW_REQUIRED" });
    const { createNewMemberFromSubmission } = await import("../review");
    await createNewMemberFromSubmission("org-a", "sub-1", ACTOR);
    expect(updateManySubmission).toHaveBeenCalledWith({
      where: { id: "sub-1", status: "REVIEW_REQUIRED" },
      data: expect.objectContaining({ matchedMemberId: null }),
    });
    expect(applySubmission).toHaveBeenCalledWith("org-a", "sub-1", ACTOR);
  });
});
