import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * MEMBER-QR-A — submissions.ts. Covers validation-against-form-definition,
 * the form-liveness re-check at the actual mutation point (not just at
 * page-load), and the match-status -> initial-submission-status routing
 * table, which is the single place §14/§15's "never auto-anything on
 * ambiguity" rule is enforced structurally.
 */

const ACTIVE_FORM_BASE = {
  id: "form-1",
  organizationId: "org-a",
  status: "ACTIVE" as const,
  expiresAt: null as Date | null,
  autoCreateNewMember: false,
  requireVerificationForExisting: true,
  duplicateHandlingMode: "REVIEW" as const,
};

const FIELDS = [
  { id: "f-first", formId: "form-1", fieldKey: "firstName", label: "First name", fieldType: "TEXT", required: true, order: 0, options: [], targetEntity: "MEMBER", targetField: "firstName", sensitivity: "HIGH", isCustomField: false },
  { id: "f-last", formId: "form-1", fieldKey: "lastName", label: "Last name", fieldType: "TEXT", required: true, order: 1, options: [], targetEntity: "MEMBER", targetField: "lastName", sensitivity: "HIGH", isCustomField: false },
  { id: "f-email", formId: "form-1", fieldKey: "email", label: "Email", fieldType: "EMAIL", required: false, order: 2, options: [], targetEntity: "MEMBER", targetField: "email", sensitivity: "HIGH", isCustomField: false },
  { id: "f-phone", formId: "form-1", fieldKey: "phone", label: "Phone", fieldType: "PHONE", required: false, order: 3, options: [], targetEntity: "MEMBER", targetField: "phone", sensitivity: "MODERATE", isCustomField: false },
];

const findUniqueForm = vi.fn();
const createSubmission = vi.fn();
const matchIntakeSubmission = vi.fn();
const resolvePublicIntakeSourceId = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    memberIntakeForm: { findUnique: (...a: unknown[]) => findUniqueForm(...a) },
    memberIntakeSubmission: { create: (...a: unknown[]) => createSubmission(...a) },
  },
}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ NEXTAUTH_SECRET: "test-secret" }) }));
vi.mock("../matching", () => ({ matchIntakeSubmission: (...a: unknown[]) => matchIntakeSubmission(...a) }));
vi.mock("../forms", () => ({ resolvePublicIntakeSourceId: (...a: unknown[]) => resolvePublicIntakeSourceId(...a) }));

beforeEach(() => {
  vi.clearAllMocks();
  resolvePublicIntakeSourceId.mockResolvedValue(null);
  createSubmission.mockImplementation((args: { data: Record<string, unknown> }) => ({ id: "sub-1", ...args.data }));
});

function mockForm(overrides: Partial<typeof ACTIVE_FORM_BASE> = {}, fields = FIELDS) {
  findUniqueForm.mockResolvedValue({ ...ACTIVE_FORM_BASE, ...overrides, fields });
}

describe("recordSubmission — form liveness", () => {
  it("rejects when the form is no longer ACTIVE (paused/archived after page-load)", async () => {
    mockForm({ status: "PAUSED" as never });
    matchIntakeSubmission.mockResolvedValue({ status: "NO_MATCH", memberId: null, candidateMemberIds: [], confidence: null, method: null });
    const { recordSubmission } = await import("../submissions");
    await expect(
      recordSubmission({ formId: "form-1", fieldValues: { firstName: "A", lastName: "B" }, ipAddress: "1.2.3.4" })
    ).rejects.toMatchObject({ code: "MEMBER_INTAKE_FORM_NOT_ACTIVE" });
  });

  it("rejects when the form has expired", async () => {
    mockForm({ expiresAt: new Date(Date.now() - 1000) });
    const { recordSubmission } = await import("../submissions");
    await expect(
      recordSubmission({ formId: "form-1", fieldValues: { firstName: "A", lastName: "B" }, ipAddress: "1.2.3.4" })
    ).rejects.toMatchObject({ code: "MEMBER_INTAKE_FORM_EXPIRED" });
  });

  it("rejects an unknown form id", async () => {
    findUniqueForm.mockResolvedValue(null);
    const { recordSubmission } = await import("../submissions");
    await expect(
      recordSubmission({ formId: "nope", fieldValues: {}, ipAddress: "1.2.3.4" })
    ).rejects.toMatchObject({ code: "MEMBER_INTAKE_FORM_NOT_FOUND" });
  });
});

describe("recordSubmission — field validation", () => {
  it("rejects a missing required field", async () => {
    mockForm();
    const { recordSubmission } = await import("../submissions");
    await expect(
      recordSubmission({ formId: "form-1", fieldValues: { firstName: "A" }, ipAddress: "1.2.3.4" })
    ).rejects.toMatchObject({ code: "MEMBER_INTAKE_VALIDATION_ERROR" });
  });

  it("rejects an invalid email", async () => {
    mockForm();
    const { recordSubmission } = await import("../submissions");
    await expect(
      recordSubmission({ formId: "form-1", fieldValues: { firstName: "A", lastName: "B", email: "not-an-email" }, ipAddress: "1.2.3.4" })
    ).rejects.toMatchObject({ code: "MEMBER_INTAKE_VALIDATION_ERROR" });
  });

  it("stores a blank optional field as null rather than dropping or erroring", async () => {
    mockForm();
    matchIntakeSubmission.mockResolvedValue({ status: "NO_MATCH", memberId: null, candidateMemberIds: [], confidence: null, method: null });
    const { recordSubmission } = await import("../submissions");
    await recordSubmission({ formId: "form-1", fieldValues: { firstName: "A", lastName: "B", email: "" }, ipAddress: "1.2.3.4" });
    const data = createSubmission.mock.calls[0][0].data;
    expect(data.fieldValues.email).toBeNull();
  });

  it("hashes the IP address, never storing it raw", async () => {
    mockForm();
    matchIntakeSubmission.mockResolvedValue({ status: "NO_MATCH", memberId: null, candidateMemberIds: [], confidence: null, method: null });
    const { recordSubmission } = await import("../submissions");
    await recordSubmission({ formId: "form-1", fieldValues: { firstName: "A", lastName: "B" }, ipAddress: "203.0.113.42" });
    const data = createSubmission.mock.calls[0][0].data;
    expect(data.submittedIpHash).not.toContain("203.0.113.42");
    expect(data.submittedIpHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("recordSubmission — status routing", () => {
  const submit = async (formOverrides: Partial<typeof ACTIVE_FORM_BASE>, matchResult: Record<string, unknown>) => {
    mockForm(formOverrides);
    matchIntakeSubmission.mockResolvedValue(matchResult);
    const { recordSubmission } = await import("../submissions");
    await recordSubmission({ formId: "form-1", fieldValues: { firstName: "A", lastName: "B" }, ipAddress: "1.2.3.4" });
    return createSubmission.mock.calls[0][0].data;
  };

  it("NO_MATCH + autoCreateNewMember=false -> REVIEW_REQUIRED", async () => {
    const data = await submit({ autoCreateNewMember: false }, { status: "NO_MATCH", memberId: null, candidateMemberIds: [], confidence: null, method: null });
    expect(data.status).toBe("REVIEW_REQUIRED");
  });

  it("NO_MATCH + autoCreateNewMember=true -> SUBMITTED", async () => {
    const data = await submit({ autoCreateNewMember: true }, { status: "NO_MATCH", memberId: null, candidateMemberIds: [], confidence: null, method: null });
    expect(data.status).toBe("SUBMITTED");
  });

  it("CONFIDENT_MATCH + requireVerificationForExisting=true -> VERIFICATION_REQUIRED, PENDING", async () => {
    const data = await submit(
      { requireVerificationForExisting: true },
      { status: "CONFIDENT_MATCH", memberId: "m-1", candidateMemberIds: ["m-1"], confidence: 100, method: "exact_email" }
    );
    expect(data.status).toBe("VERIFICATION_REQUIRED");
    expect(data.verificationStatus).toBe("PENDING");
    expect(data.matchedMemberId).toBe("m-1");
  });

  it("CONFIDENT_MATCH + verification off + AUTO_LINK_CONFIDENT -> SUBMITTED", async () => {
    const data = await submit(
      { requireVerificationForExisting: false, duplicateHandlingMode: "AUTO_LINK_CONFIDENT" as never },
      { status: "CONFIDENT_MATCH", memberId: "m-1", candidateMemberIds: ["m-1"], confidence: 100, method: "exact_email" }
    );
    expect(data.status).toBe("SUBMITTED");
  });

  it("CONFIDENT_MATCH + verification off + REVIEW mode -> REVIEW_REQUIRED", async () => {
    const data = await submit(
      { requireVerificationForExisting: false, duplicateHandlingMode: "REVIEW" as never },
      { status: "CONFIDENT_MATCH", memberId: "m-1", candidateMemberIds: ["m-1"], confidence: 100, method: "exact_email" }
    );
    expect(data.status).toBe("REVIEW_REQUIRED");
  });

  it("POSSIBLE_MATCH always -> REVIEW_REQUIRED, regardless of duplicateHandlingMode, with candidates stored and no matchedMemberId", async () => {
    const data = await submit(
      { duplicateHandlingMode: "AUTO_LINK_CONFIDENT" as never },
      { status: "POSSIBLE_MATCH", memberId: null, candidateMemberIds: ["m-1", "m-2"], confidence: 50, method: "name+corroborating" }
    );
    expect(data.status).toBe("REVIEW_REQUIRED");
    expect(data.matchedMemberId).toBeNull();
    expect(data.candidateMemberIds).toEqual(["m-1", "m-2"]);
  });

  it("MULTIPLE_MATCHES always -> REVIEW_REQUIRED", async () => {
    const data = await submit(
      { duplicateHandlingMode: "AUTO_LINK_CONFIDENT" as never },
      { status: "MULTIPLE_MATCHES", memberId: null, candidateMemberIds: ["m-1", "m-2"], confidence: 100, method: "exact_email" }
    );
    expect(data.status).toBe("REVIEW_REQUIRED");
  });
});
