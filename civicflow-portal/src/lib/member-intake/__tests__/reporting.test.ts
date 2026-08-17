import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * MEMBER-QR-I — reporting.ts. Covers getFormStatistics' derived counts
 * (completed/new-members/updates/needs-review/possible-duplicates/rejected/
 * verification-rate/by-source) and getMemberIntakeProvenance's "most recent
 * APPLIED submission touching this member" query.
 */

const findFirstForm = vi.fn();
const findManySubmission = vi.fn();
const findFirstSubmission = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    memberIntakeForm: { findFirst: (...a: unknown[]) => findFirstForm(...a) },
    memberIntakeSubmission: {
      findMany: (...a: unknown[]) => findManySubmission(...a),
      findFirst: (...a: unknown[]) => findFirstSubmission(...a),
    },
  },
}));

beforeEach(() => vi.clearAllMocks());

function submission(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: "APPLIED",
    createdMemberId: null,
    matchedMemberId: "m-1",
    appliedAt: new Date(),
    candidateMemberIds: [],
    verificationStatus: "NOT_REQUIRED",
    sourceId: null,
    fieldValues: {},
    ...overrides,
  };
}

describe("getFormStatistics", () => {
  it("throws MEMBER_INTAKE_FORM_NOT_FOUND when the form doesn't exist in this org", async () => {
    findFirstForm.mockResolvedValue(null);
    const { getFormStatistics } = await import("../reporting");
    await expect(getFormStatistics("org-a", "form-1")).rejects.toMatchObject({ code: "MEMBER_INTAKE_FORM_NOT_FOUND" });
  });

  it("tallies completed/new-members/updates/needs-review/possible-duplicates/rejected correctly", async () => {
    findFirstForm.mockResolvedValue({ fields: [], sources: [] });
    findManySubmission.mockResolvedValue([
      submission({ status: "APPLIED", createdMemberId: "m-new", matchedMemberId: null }), // new member
      submission({ status: "APPLIED", matchedMemberId: "m-1", appliedAt: new Date() }), // update
      submission({ status: "REVIEW_REQUIRED", matchedMemberId: null, appliedAt: null, candidateMemberIds: [] }), // plain review
      submission({ status: "REVIEW_REQUIRED", matchedMemberId: null, appliedAt: null, candidateMemberIds: ["m-2", "m-3"] }), // possible duplicate
      submission({ status: "REJECTED", matchedMemberId: null, appliedAt: null }),
    ]);

    const { getFormStatistics } = await import("../reporting");
    const stats = await getFormStatistics("org-a", "form-1");

    expect(stats.totalSubmissions).toBe(5);
    expect(stats.newMembersCreated).toBe(1);
    expect(stats.existingMembersUpdated).toBe(1);
    expect(stats.needsReview).toBe(2);
    expect(stats.possibleDuplicates).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.completedSubmissions).toBe(2);
  });

  it("computes verification completion rate only from submissions that actually required it", async () => {
    findFirstForm.mockResolvedValue({ fields: [], sources: [] });
    findManySubmission.mockResolvedValue([
      submission({ verificationStatus: "VERIFIED" }),
      submission({ verificationStatus: "VERIFIED" }),
      submission({ verificationStatus: "PENDING" }),
      submission({ verificationStatus: "NOT_REQUIRED" }),
    ]);
    const { getFormStatistics } = await import("../reporting");
    const stats = await getFormStatistics("org-a", "form-1");
    expect(stats.verificationRequested).toBe(3);
    expect(stats.verificationCompleted).toBe(2);
    expect(stats.verificationCompletionRate).toBeCloseTo(2 / 3);
  });

  it("returns null verificationCompletionRate when nothing ever required verification", async () => {
    findFirstForm.mockResolvedValue({ fields: [], sources: [] });
    findManySubmission.mockResolvedValue([submission({ verificationStatus: "NOT_REQUIRED" })]);
    const { getFormStatistics } = await import("../reporting");
    const stats = await getFormStatistics("org-a", "form-1");
    expect(stats.verificationCompletionRate).toBeNull();
  });

  it("counts an address-field update only for applied updates that submitted a non-blank value", async () => {
    findFirstForm.mockResolvedValue({
      fields: [{ fieldKey: "addressLine1", targetField: "addressLine1" }],
      sources: [],
    });
    findManySubmission.mockResolvedValue([
      submission({ status: "APPLIED", matchedMemberId: "m-1", appliedAt: new Date(), fieldValues: { addressLine1: "123 Main St" } }),
      submission({ status: "APPLIED", matchedMemberId: "m-2", appliedAt: new Date(), fieldValues: { addressLine1: "" } }), // blank -- not counted
      submission({ status: "APPLIED", createdMemberId: "m-new", matchedMemberId: null, appliedAt: new Date(), fieldValues: { addressLine1: "456 Oak Ave" } }), // new member, not an "update"
    ]);
    const { getFormStatistics } = await import("../reporting");
    const stats = await getFormStatistics("org-a", "form-1");
    expect(stats.addressFieldUpdates).toBe(1);
  });

  it("groups by source, with a 'Direct link (no source)' bucket for submissions with no sourceId", async () => {
    findFirstForm.mockResolvedValue({ fields: [], sources: [{ id: "src-1", name: "Sunday Service" }] });
    findManySubmission.mockResolvedValue([submission({ sourceId: "src-1" }), submission({ sourceId: "src-1" }), submission({ sourceId: null })]);
    const { getFormStatistics } = await import("../reporting");
    const stats = await getFormStatistics("org-a", "form-1");
    expect(stats.bySource).toEqual(
      expect.arrayContaining([
        { sourceId: "src-1", sourceName: "Sunday Service", count: 2 },
        { sourceId: null, sourceName: "Direct link (no source)", count: 1 },
      ])
    );
  });
});

describe("getMemberIntakeProvenance", () => {
  it("returns null when this member was never touched by Member Intake", async () => {
    findFirstSubmission.mockResolvedValue(null);
    const { getMemberIntakeProvenance } = await import("../reporting");
    expect(await getMemberIntakeProvenance("org-a", "m-1")).toBeNull();
  });

  it("reports wasNewMember correctly for a submission that created this member", async () => {
    findFirstSubmission.mockResolvedValue({ id: "sub-1", appliedAt: new Date(), createdMemberId: "m-1", form: { name: "Join Us" } });
    const { getMemberIntakeProvenance } = await import("../reporting");
    const result = await getMemberIntakeProvenance("org-a", "m-1");
    expect(result?.wasNewMember).toBe(true);
    expect(result?.formName).toBe("Join Us");
  });

  it("reports wasNewMember: false for a submission that updated an existing member", async () => {
    findFirstSubmission.mockResolvedValue({ id: "sub-1", appliedAt: new Date(), createdMemberId: null, form: { name: "Update Info" } });
    const { getMemberIntakeProvenance } = await import("../reporting");
    const result = await getMemberIntakeProvenance("org-a", "m-1");
    expect(result?.wasNewMember).toBe(false);
  });
});
