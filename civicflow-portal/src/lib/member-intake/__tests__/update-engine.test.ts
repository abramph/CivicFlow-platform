import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * MEMBER-QR-A — update-engine.ts. Covers the sensitivity-gating rule (HIGH
 * never auto-applies regardless of org policy; MODERATE only when policy
 * explicitly allows it), the all-or-nothing-per-submission apply decision,
 * §17's "blank never erases" rule, and that every write goes through the
 * existing createMember/updateMember business logic rather than a raw
 * prisma call.
 */

const findFirstSubmission = vi.fn();
const findFirstOrgMember = vi.fn();
const updateSubmission = vi.fn();
const updateMember = vi.fn();
const createMember = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    memberIntakeSubmission: {
      findFirst: (...a: unknown[]) => findFirstSubmission(...a),
      update: (...a: unknown[]) => updateSubmission(...a),
    },
    orgMember: { findFirst: (...a: unknown[]) => findFirstOrgMember(...a) },
  },
}));
vi.mock("@/lib/member-mutations", () => ({
  updateMember: (...a: unknown[]) => updateMember(...a),
  createMember: (...a: unknown[]) => createMember(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  updateSubmission.mockImplementation((args: { data: Record<string, unknown> }) => ({ status: args.data.status ?? "APPLIED", ...args.data }));
  updateMember.mockResolvedValue({ ok: true, data: { id: "m-1" } });
  createMember.mockResolvedValue({ ok: true, data: { id: "m-new" } });
});

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

const ACTOR = { userId: null, userEmail: null };

describe("applySubmission — status eligibility", () => {
  it("refuses to apply a REVIEW_REQUIRED submission (must be approved first)", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "REVIEW_REQUIRED",
      matchedMemberId: null,
      fieldValues: {},
      form: { fields: [], autoCreateNewMember: false, autoApplySafeUpdates: false, requireReviewForSensitiveUpdates: true },
    });
    const { applySubmission } = await import("../update-engine");
    await expect(applySubmission("org-a", "sub-1", ACTOR)).rejects.toMatchObject({ code: "MEMBER_INTAKE_INVALID_STATUS_TRANSITION" });
    expect(updateMember).not.toHaveBeenCalled();
    expect(createMember).not.toHaveBeenCalled();
  });

  it("refuses a VERIFICATION_REQUIRED submission whose identity was never actually verified", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "VERIFICATION_REQUIRED",
      verificationStatus: "PENDING",
      matchedMemberId: "m-1",
      fieldValues: {},
      form: { fields: [], autoCreateNewMember: false, autoApplySafeUpdates: true, requireReviewForSensitiveUpdates: true },
    });
    const { applySubmission } = await import("../update-engine");
    await expect(applySubmission("org-a", "sub-1", ACTOR)).rejects.toMatchObject({ code: "MEMBER_INTAKE_INVALID_STATUS_TRANSITION" });
    expect(updateMember).not.toHaveBeenCalled();
  });
});

describe("applySubmission — sensitivity gating (update path)", () => {
  it("never auto-applies a HIGH-sensitivity field change, even with autoApplySafeUpdates on -- routes to REVIEW_REQUIRED instead", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "SUBMITTED",
      matchedMemberId: "m-1",
      fieldValues: { email: "new@example.com" },
      form: {
        fields: [field({ fieldKey: "email", targetField: "email", sensitivity: "HIGH" })],
        autoApplySafeUpdates: true,
        requireReviewForSensitiveUpdates: false,
      },
    });
    findFirstOrgMember.mockResolvedValue({ id: "m-1", email: "old@example.com" });

    const { applySubmission } = await import("../update-engine");
    const result = await applySubmission("org-a", "sub-1", ACTOR);

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(updateMember).not.toHaveBeenCalled();
    expect(updateSubmission).toHaveBeenCalledWith({ where: { id: "sub-1" }, data: { status: "REVIEW_REQUIRED" } });
  });

  it("auto-applies a LOW-sensitivity field change when autoApplySafeUpdates is on", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "SUBMITTED",
      matchedMemberId: "m-1",
      fieldValues: { preferredName: "Bobby" },
      form: {
        fields: [field({ fieldKey: "preferredName", targetField: "preferredName", sensitivity: "LOW" })],
        autoApplySafeUpdates: true,
        requireReviewForSensitiveUpdates: true,
      },
    });
    findFirstOrgMember.mockResolvedValue({ id: "m-1", preferredName: "Robert" });

    const { applySubmission } = await import("../update-engine");
    const result = await applySubmission("org-a", "sub-1", ACTOR);

    expect(updateMember).toHaveBeenCalledWith("org-a", ACTOR, "m-1", { preferredName: "Bobby" });
    expect(result.status).toBe("APPLIED");
    expect(result.appliedFieldCount).toBe(1);
  });

  it("blocks a MODERATE field when requireReviewForSensitiveUpdates is on, even with autoApplySafeUpdates true", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "SUBMITTED",
      matchedMemberId: "m-1",
      fieldValues: { phone: "+12155559999" },
      form: {
        fields: [field({ fieldKey: "phone", targetField: "phone", sensitivity: "MODERATE" })],
        autoApplySafeUpdates: true,
        requireReviewForSensitiveUpdates: true,
      },
    });
    findFirstOrgMember.mockResolvedValue({ id: "m-1", phone: "+12155551111" });

    const { applySubmission } = await import("../update-engine");
    const result = await applySubmission("org-a", "sub-1", ACTOR);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(updateMember).not.toHaveBeenCalled();
  });

  it("allows a MODERATE field when requireReviewForSensitiveUpdates is off", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "SUBMITTED",
      matchedMemberId: "m-1",
      fieldValues: { phone: "+12155559999" },
      form: {
        fields: [field({ fieldKey: "phone", targetField: "phone", sensitivity: "MODERATE" })],
        autoApplySafeUpdates: true,
        requireReviewForSensitiveUpdates: false,
      },
    });
    findFirstOrgMember.mockResolvedValue({ id: "m-1", phone: "+12155551111" });

    const { applySubmission } = await import("../update-engine");
    const result = await applySubmission("org-a", "sub-1", ACTOR);
    expect(updateMember).toHaveBeenCalledWith("org-a", ACTOR, "m-1", { phone: "+12155559999" });
    expect(result.status).toBe("APPLIED");
  });

  it("never auto-applies anything when autoApplySafeUpdates is off, even for LOW fields", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "SUBMITTED",
      matchedMemberId: "m-1",
      fieldValues: { preferredName: "Bobby" },
      form: {
        fields: [field({ fieldKey: "preferredName", targetField: "preferredName", sensitivity: "LOW" })],
        autoApplySafeUpdates: false,
        requireReviewForSensitiveUpdates: true,
      },
    });
    findFirstOrgMember.mockResolvedValue({ id: "m-1", preferredName: "Robert" });

    const { applySubmission } = await import("../update-engine");
    const result = await applySubmission("org-a", "sub-1", ACTOR);
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(updateMember).not.toHaveBeenCalled();
  });
});

describe("applySubmission — blank never erases (§17)", () => {
  it("skips a field entirely when the submitted value is null, leaving the existing value untouched", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "SUBMITTED",
      matchedMemberId: "m-1",
      fieldValues: { preferredName: null, phone: "+12155559999" },
      form: {
        fields: [
          field({ fieldKey: "preferredName", targetField: "preferredName", sensitivity: "LOW" }),
          field({ fieldKey: "phone", targetField: "phone", sensitivity: "LOW" }),
        ],
        autoApplySafeUpdates: true,
        requireReviewForSensitiveUpdates: false,
      },
    });
    findFirstOrgMember.mockResolvedValue({ id: "m-1", preferredName: "Robert", phone: "+12155551111" });

    const { applySubmission } = await import("../update-engine");
    await applySubmission("org-a", "sub-1", ACTOR);

    const input = updateMember.mock.calls[0][3];
    expect(input).not.toHaveProperty("preferredName");
    expect(input.phone).toBe("+12155559999");
  });

  it("is a no-op (still APPLIED, zero appliedFieldCount, updateMember never called) when nothing actually differs", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "SUBMITTED",
      matchedMemberId: "m-1",
      fieldValues: { preferredName: "Robert" },
      form: {
        fields: [field({ fieldKey: "preferredName", targetField: "preferredName", sensitivity: "LOW" })],
        autoApplySafeUpdates: true,
        requireReviewForSensitiveUpdates: false,
      },
    });
    findFirstOrgMember.mockResolvedValue({ id: "m-1", preferredName: "Robert" });

    const { applySubmission } = await import("../update-engine");
    const result = await applySubmission("org-a", "sub-1", ACTOR);
    expect(updateMember).not.toHaveBeenCalled();
    expect(result.appliedFieldCount).toBe(0);
    expect(result.status).toBe("APPLIED");
  });
});

describe("applySubmission — new-member creation path", () => {
  it("creates a new member via the shared createMember service when NO_MATCH + autoCreateNewMember", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "SUBMITTED",
      matchedMemberId: null,
      fieldValues: { firstName: "New", lastName: "Person" },
      form: {
        fields: [
          field({ fieldKey: "firstName", targetField: "firstName", sensitivity: "HIGH" }),
          field({ fieldKey: "lastName", targetField: "lastName", sensitivity: "HIGH" }),
        ],
        autoCreateNewMember: true,
        autoApplySafeUpdates: false,
        requireReviewForSensitiveUpdates: true,
      },
    });

    const { applySubmission } = await import("../update-engine");
    const result = await applySubmission("org-a", "sub-1", ACTOR);

    expect(createMember).toHaveBeenCalledWith("org-a", ACTOR, { firstName: "New", lastName: "Person" });
    expect(result.memberId).toBe("m-new");
    expect(result.status).toBe("APPLIED");
  });

  it("refuses to create a new member without a first and last name", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "SUBMITTED",
      matchedMemberId: null,
      fieldValues: { firstName: "Only" },
      form: {
        fields: [field({ fieldKey: "firstName", targetField: "firstName", sensitivity: "HIGH" })],
        autoCreateNewMember: true,
        autoApplySafeUpdates: false,
        requireReviewForSensitiveUpdates: true,
      },
    });
    const { applySubmission } = await import("../update-engine");
    await expect(applySubmission("org-a", "sub-1", ACTOR)).rejects.toMatchObject({ code: "MEMBER_INTAKE_VALIDATION_ERROR" });
    expect(createMember).not.toHaveBeenCalled();
  });

  it("refuses to create a new member when the form doesn't allow it and no admin approval happened", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "SUBMITTED",
      matchedMemberId: null,
      fieldValues: { firstName: "New", lastName: "Person" },
      form: {
        fields: [],
        autoCreateNewMember: false,
        autoApplySafeUpdates: false,
        requireReviewForSensitiveUpdates: true,
      },
    });
    const { applySubmission } = await import("../update-engine");
    await expect(applySubmission("org-a", "sub-1", ACTOR)).rejects.toMatchObject({ code: "MEMBER_INTAKE_INVALID_STATUS_TRANSITION" });
    expect(createMember).not.toHaveBeenCalled();
  });
});
