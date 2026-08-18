import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * MEMBER-QR-J — self-service.ts. Covers the lazy get-or-create system form,
 * that submissions are created with the authenticated member as the
 * confident match (no matching.ts involvement, no verification requirement
 * -- the session IS the identity signal), and that applySubmission's own
 * sensitivity gating (already covered exhaustively by update-engine.test.ts)
 * is what decides auto-apply vs. review here too -- self-service never
 * bypasses it.
 */

const findFirstForm = vi.fn();
const createForm = vi.fn();
const createManyField = vi.fn();
const findFirstOrThrowForm = vi.fn();
const createSubmission = vi.fn();
const applySubmission = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    memberIntakeForm: {
      findFirst: (...a: unknown[]) => findFirstForm(...a),
      create: (...a: unknown[]) => createForm(...a),
      findFirstOrThrow: (...a: unknown[]) => findFirstOrThrowForm(...a),
    },
    memberIntakeFormField: { createMany: (...a: unknown[]) => createManyField(...a) },
    memberIntakeSubmission: { create: (...a: unknown[]) => createSubmission(...a) },
  },
}));
vi.mock("../update-engine", () => ({ applySubmission: (...a: unknown[]) => applySubmission(...a) }));

const ACTOR = { userId: "user-1", userEmail: "member@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  createSubmission.mockResolvedValue({ id: "sub-1" });
  applySubmission.mockResolvedValue({ status: "APPLIED", memberId: "m-1", appliedFieldCount: 1 });
});

function existingForm(fields: { fieldKey: string; label: string; fieldType?: string }[]) {
  return {
    id: "form-self-service",
    fields: fields.map((f) => ({ id: `f-${f.fieldKey}`, fieldKey: f.fieldKey, label: f.label, fieldType: f.fieldType ?? "TEXT", required: false, options: [] })),
  };
}

describe("getOrCreateSelfServiceForm (via submitMemberSelfServiceUpdate)", () => {
  it("reuses an existing self-service form rather than creating a new one", async () => {
    findFirstForm.mockResolvedValue(existingForm([{ fieldKey: "phone", label: "Phone" }]));
    const { submitMemberSelfServiceUpdate } = await import("../self-service");
    await submitMemberSelfServiceUpdate("org-a", "m-1", ACTOR, { phone: "+12155551111" });
    expect(createForm).not.toHaveBeenCalled();
  });

  it("creates the system form + its full field set on first use for an organization", async () => {
    findFirstForm.mockResolvedValue(null);
    createForm.mockResolvedValue({ id: "form-new" });
    findFirstOrThrowForm.mockResolvedValue(existingForm([{ fieldKey: "phone", label: "Phone" }]));
    const { submitMemberSelfServiceUpdate } = await import("../self-service");
    await submitMemberSelfServiceUpdate("org-a", "m-1", ACTOR, { phone: "+12155551111" });

    expect(createForm).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-a", purpose: "PROFILE_UPDATE", status: "DRAFT" }) }));
    expect(createManyField).toHaveBeenCalled();
    const fieldRows = createManyField.mock.calls[0][0].data as { targetField: string }[];
    expect(fieldRows.map((f) => f.targetField)).toContain("email");
    expect(fieldRows.map((f) => f.targetField)).not.toContain("commsEmailEnabled"); // comms toggles stay on the existing PATCH path
  });

  it("floors each field's stored sensitivity to its authoritative minimum, never LOW across the board", async () => {
    findFirstForm.mockResolvedValue(null);
    createForm.mockResolvedValue({ id: "form-new" });
    findFirstOrThrowForm.mockResolvedValue(existingForm([{ fieldKey: "phone", label: "Phone" }]));
    const { submitMemberSelfServiceUpdate } = await import("../self-service");
    await submitMemberSelfServiceUpdate("org-a", "m-1", ACTOR, { phone: "+12155551111" });

    const fieldRows = createManyField.mock.calls[0][0].data as { targetField: string; sensitivity: string }[];
    const byField = Object.fromEntries(fieldRows.map((f) => [f.targetField, f.sensitivity]));
    // Regression: these were previously hardcoded to LOW, which let a
    // mobile self-service legal-name/email/DOB change auto-apply with zero
    // review -- effectiveFieldSensitivity's floor must actually be applied
    // at field-creation time, not just claimed in a comment.
    expect(byField.firstName).toBe("HIGH");
    expect(byField.lastName).toBe("HIGH");
    expect(byField.email).toBe("HIGH");
    expect(byField.dateOfBirth).toBe("HIGH");
    expect(byField.phone).toBe("MODERATE");
    expect(byField.addressLine1).toBe("MODERATE");
    expect(byField.preferredName).toBe("LOW");
  });
});

describe("submitMemberSelfServiceUpdate", () => {
  it("creates the submission pre-matched to the authenticated member, with no verification required", async () => {
    findFirstForm.mockResolvedValue(existingForm([{ fieldKey: "phone", label: "Phone" }]));
    const { submitMemberSelfServiceUpdate } = await import("../self-service");
    await submitMemberSelfServiceUpdate("org-a", "m-1", ACTOR, { phone: "+12155551111" });

    expect(createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matchedMemberId: "m-1",
          verificationStatus: "NOT_REQUIRED",
          status: "SUBMITTED",
          matchMethod: "authenticated_session",
        }),
      })
    );
    expect(applySubmission).toHaveBeenCalledWith("org-a", "sub-1", ACTOR);
  });

  it("ignores any submitted key that isn't part of the self-service field set", async () => {
    findFirstForm.mockResolvedValue(existingForm([{ fieldKey: "phone", label: "Phone" }]));
    const { submitMemberSelfServiceUpdate } = await import("../self-service");
    await submitMemberSelfServiceUpdate("org-a", "m-1", ACTOR, { phone: "+12155551111", membershipStatus: "terminated" } as never);

    const values = createSubmission.mock.calls[0][0].data.fieldValues;
    expect(values).not.toHaveProperty("membershipStatus");
  });

  it("validates each provided value against its field definition before storing it", async () => {
    findFirstForm.mockResolvedValue(existingForm([{ fieldKey: "email", label: "Email", fieldType: "EMAIL" }]));
    const { submitMemberSelfServiceUpdate } = await import("../self-service");
    await expect(submitMemberSelfServiceUpdate("org-a", "m-1", ACTOR, { email: "not-an-email" })).rejects.toMatchObject({
      code: "MEMBER_INTAKE_VALIDATION_ERROR",
    });
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it("returns applySubmission's own status/appliedFieldCount unchanged", async () => {
    findFirstForm.mockResolvedValue(existingForm([{ fieldKey: "email", label: "Email" }]));
    applySubmission.mockResolvedValue({ status: "REVIEW_REQUIRED", memberId: "m-1", appliedFieldCount: 0 });
    const { submitMemberSelfServiceUpdate } = await import("../self-service");
    const result = await submitMemberSelfServiceUpdate("org-a", "m-1", ACTOR, { email: "new@example.com" });
    expect(result).toEqual({ status: "REVIEW_REQUIRED", appliedFieldCount: 0 });
  });
});
