import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MEMBER-QR-C — public route tests. These routes are thin orchestration
 * over already-unit-tested services (matching.test.ts, submissions.test.ts,
 * verification.test.ts, update-engine.test.ts), so what's worth testing
 * here is the ORCHESTRATION itself: which service gets called for which
 * outcome, that organizationId/formId are always resolved server-side
 * (never trusted from the request), and that a cross-token submissionId
 * replay is rejected.
 */

const resolvePublicIntakeForm = vi.fn();
const recordSubmission = vi.fn();
const resolvePublicSubmissionOrgId = vi.fn();
const requestVerification = vi.fn();
const verifySubmissionCode = vi.fn();
const applySubmission = vi.fn();

vi.mock("@/lib/member-intake/forms", () => ({ resolvePublicIntakeForm: (...a: unknown[]) => resolvePublicIntakeForm(...a) }));
vi.mock("@/lib/member-intake/submissions", () => ({
  recordSubmission: (...a: unknown[]) => recordSubmission(...a),
  resolvePublicSubmissionOrgId: (...a: unknown[]) => resolvePublicSubmissionOrgId(...a),
}));
vi.mock("@/lib/member-intake/verification", () => ({
  requestVerification: (...a: unknown[]) => requestVerification(...a),
  verifySubmissionCode: (...a: unknown[]) => verifySubmissionCode(...a),
}));
vi.mock("@/lib/member-intake/update-engine", () => ({ applySubmission: (...a: unknown[]) => applySubmission(...a) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null), getClientIp: () => "203.0.113.5" }));

beforeEach(() => {
  vi.clearAllMocks();
});

function jsonRequest(url: string, body?: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("POST /api/public/member-intake/[token]/submit", () => {
  it("404s for an unknown/inactive/expired token without ever calling recordSubmission", async () => {
    resolvePublicIntakeForm.mockResolvedValue(null);
    const { POST } = await import("@/app/api/public/member-intake/[token]/submit/route");
    const response = await POST(jsonRequest("https://app.test/api/public/member-intake/bad-token/submit", { fieldValues: {} }), {
      params: Promise.resolve({ token: "bad-token" }),
    });
    expect(response.status).toBe(404);
    expect(recordSubmission).not.toHaveBeenCalled();
  });

  it("resolves organizationId/formId from the token server-side, never from the request body", async () => {
    resolvePublicIntakeForm.mockResolvedValue({ id: "form-1", organizationId: "org-a" });
    recordSubmission.mockResolvedValue({ submissionId: "sub-1", status: "REVIEW_REQUIRED", matchedMemberId: null });
    const { POST } = await import("@/app/api/public/member-intake/[token]/submit/route");
    await POST(
      jsonRequest("https://app.test/api/public/member-intake/tok/submit", {
        fieldValues: { firstName: "A" },
        // An attacker-controlled body claiming a different org -- must be ignored entirely.
        organizationId: "org-b",
        formId: "form-attacker-controlled",
      }),
      { params: Promise.resolve({ token: "tok" }) }
    );
    expect(recordSubmission).toHaveBeenCalledWith(expect.objectContaining({ formId: "form-1" }));
  });

  it("MEMBER-QR-L: accepts an explicit sourceToken: null (the real public form client's payload shape for a direct/no-source link, not omitted/undefined) instead of 400ing", async () => {
    resolvePublicIntakeForm.mockResolvedValue({ id: "form-1", organizationId: "org-a" });
    recordSubmission.mockResolvedValue({ submissionId: "sub-1", status: "REVIEW_REQUIRED", matchedMemberId: null });
    const { POST } = await import("@/app/api/public/member-intake/[token]/submit/route");
    const response = await POST(
      jsonRequest("https://app.test/api/public/member-intake/tok/submit", { fieldValues: { firstName: "A" }, sourceToken: null }),
      { params: Promise.resolve({ token: "tok" }) }
    );
    expect(response.status).toBe(200);
    expect(recordSubmission).toHaveBeenCalledWith(expect.objectContaining({ sourceToken: null }));
  });

  it("VERIFICATION_REQUIRED path sends a verification code and never applies anything yet", async () => {
    resolvePublicIntakeForm.mockResolvedValue({ id: "form-1", organizationId: "org-a" });
    recordSubmission.mockResolvedValue({ submissionId: "sub-1", status: "VERIFICATION_REQUIRED", matchedMemberId: "m-1" });
    requestVerification.mockResolvedValue({ channel: "EMAIL", maskedDestination: "j***@example.com" });

    const { POST } = await import("@/app/api/public/member-intake/[token]/submit/route");
    const response = await POST(jsonRequest("https://app.test/api/public/member-intake/tok/submit", { fieldValues: {} }), {
      params: Promise.resolve({ token: "tok" }),
    });
    const body = await response.json();

    expect(body.data.outcome).toBe("VERIFICATION_REQUIRED");
    expect(body.data.verification.maskedDestination).toBe("j***@example.com");
    expect(requestVerification).toHaveBeenCalledWith("org-a", "sub-1");
    expect(applySubmission).not.toHaveBeenCalled();
  });

  it("SUBMITTED + no prior match -> applies immediately and reports NEW_MEMBER_CREATED", async () => {
    resolvePublicIntakeForm.mockResolvedValue({ id: "form-1", organizationId: "org-a" });
    recordSubmission.mockResolvedValue({ submissionId: "sub-1", status: "SUBMITTED", matchedMemberId: null });
    applySubmission.mockResolvedValue({ status: "APPLIED", memberId: "m-new", appliedFieldCount: 3 });

    const { POST } = await import("@/app/api/public/member-intake/[token]/submit/route");
    const response = await POST(jsonRequest("https://app.test/api/public/member-intake/tok/submit", { fieldValues: {} }), {
      params: Promise.resolve({ token: "tok" }),
    });
    const body = await response.json();

    expect(body.data.outcome).toBe("NEW_MEMBER_CREATED");
    expect(applySubmission).toHaveBeenCalledWith("org-a", "sub-1", { userId: null, userEmail: null });
  });

  it("SUBMITTED + prior CONFIDENT_MATCH -> applies immediately and reports UPDATE_APPLIED", async () => {
    resolvePublicIntakeForm.mockResolvedValue({ id: "form-1", organizationId: "org-a" });
    recordSubmission.mockResolvedValue({ submissionId: "sub-1", status: "SUBMITTED", matchedMemberId: "m-1" });
    applySubmission.mockResolvedValue({ status: "APPLIED", memberId: "m-1", appliedFieldCount: 1 });

    const { POST } = await import("@/app/api/public/member-intake/[token]/submit/route");
    const response = await POST(jsonRequest("https://app.test/api/public/member-intake/tok/submit", { fieldValues: {} }), {
      params: Promise.resolve({ token: "tok" }),
    });
    const body = await response.json();
    expect(body.data.outcome).toBe("UPDATE_APPLIED");
  });

  it("REVIEW_REQUIRED path never calls applySubmission or requestVerification", async () => {
    resolvePublicIntakeForm.mockResolvedValue({ id: "form-1", organizationId: "org-a" });
    recordSubmission.mockResolvedValue({ submissionId: "sub-1", status: "REVIEW_REQUIRED", matchedMemberId: null });

    const { POST } = await import("@/app/api/public/member-intake/[token]/submit/route");
    const response = await POST(jsonRequest("https://app.test/api/public/member-intake/tok/submit", { fieldValues: {} }), {
      params: Promise.resolve({ token: "tok" }),
    });
    const body = await response.json();
    expect(body.data.outcome).toBe("REVIEW_REQUIRED");
    expect(applySubmission).not.toHaveBeenCalled();
    expect(requestVerification).not.toHaveBeenCalled();
  });
});

describe("POST /api/public/member-intake/[token]/verify/confirm", () => {
  it("rejects a submissionId that doesn't belong to this token's form", async () => {
    resolvePublicSubmissionOrgId.mockResolvedValue(null);
    const { POST } = await import("@/app/api/public/member-intake/[token]/verify/confirm/route");
    const response = await POST(jsonRequest("https://app.test/api/public/member-intake/tok/verify/confirm", { submissionId: "sub-from-other-form", code: "123456" }), {
      params: Promise.resolve({ token: "tok" }),
    });
    expect(response.status).toBe(404);
    expect(verifySubmissionCode).not.toHaveBeenCalled();
  });

  it("applies the submission only after a successful code check", async () => {
    resolvePublicSubmissionOrgId.mockResolvedValue("org-a");
    verifySubmissionCode.mockResolvedValue({ ok: true });
    applySubmission.mockResolvedValue({ status: "APPLIED", memberId: "m-1", appliedFieldCount: 1 });

    const { POST } = await import("@/app/api/public/member-intake/[token]/verify/confirm/route");
    const response = await POST(jsonRequest("https://app.test/api/public/member-intake/tok/verify/confirm", { submissionId: "sub-1", code: "123456" }), {
      params: Promise.resolve({ token: "tok" }),
    });
    const body = await response.json();
    expect(body.data.outcome).toBe("UPDATE_APPLIED");
    expect(applySubmission).toHaveBeenCalledWith("org-a", "sub-1", { userId: null, userEmail: null });
  });

  it("never applies anything when the code is wrong", async () => {
    resolvePublicSubmissionOrgId.mockResolvedValue("org-a");
    verifySubmissionCode.mockResolvedValue({ ok: false, error: "Invalid code. Please try again." });

    const { POST } = await import("@/app/api/public/member-intake/[token]/verify/confirm/route");
    const response = await POST(jsonRequest("https://app.test/api/public/member-intake/tok/verify/confirm", { submissionId: "sub-1", code: "000000" }), {
      params: Promise.resolve({ token: "tok" }),
    });
    expect(response.status).toBe(400);
    expect(applySubmission).not.toHaveBeenCalled();
  });
});

describe("POST /api/public/member-intake/[token]/verify/request", () => {
  it("rejects a submissionId that doesn't belong to this token's form", async () => {
    resolvePublicSubmissionOrgId.mockResolvedValue(null);
    const { POST } = await import("@/app/api/public/member-intake/[token]/verify/request/route");
    const response = await POST(jsonRequest("https://app.test/api/public/member-intake/tok/verify/request", { submissionId: "sub-x" }), {
      params: Promise.resolve({ token: "tok" }),
    });
    expect(response.status).toBe(404);
    expect(requestVerification).not.toHaveBeenCalled();
  });

  it("resends a code for a valid submission", async () => {
    resolvePublicSubmissionOrgId.mockResolvedValue("org-a");
    requestVerification.mockResolvedValue({ channel: "SMS", maskedDestination: "•••1234" });
    const { POST } = await import("@/app/api/public/member-intake/[token]/verify/request/route");
    const response = await POST(jsonRequest("https://app.test/api/public/member-intake/tok/verify/request", { submissionId: "sub-1" }), {
      params: Promise.resolve({ token: "tok" }),
    });
    const body = await response.json();
    expect(body.data.maskedDestination).toBe("•••1234");
  });
});
