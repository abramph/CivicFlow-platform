import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * MEMBER-QR-A/E — verification.ts. The single most security-critical test
 * here is "never verify using the newly-submitted email/phone" (§15's
 * explicit rule): a submission's own fieldValues must never be consulted
 * for the destination -- only the matched OrgMember's own existing columns.
 * MEMBER-QR-E adds the token-scoped attempt cap: a route-level IP rate
 * limit alone is trivially bypassed by rotating source IPs, so a 6-digit
 * code needs its own per-token guess limit to resist brute force within its
 * 10-minute window.
 */

const findFirstSubmission = vi.fn();
const deleteManyTokens = vi.fn();
const createToken = vi.fn();
const updateToken = vi.fn();
const updateSubmission = vi.fn();
const findFirstToken = vi.fn();
const sendEmail = vi.fn();
const sendSms = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    memberIntakeSubmission: {
      findFirst: (...a: unknown[]) => findFirstSubmission(...a),
      update: (...a: unknown[]) => updateSubmission(...a),
    },
    memberIntakeVerificationToken: {
      deleteMany: (...a: unknown[]) => deleteManyTokens(...a),
      create: (...a: unknown[]) => createToken(...a),
      update: (...a: unknown[]) => updateToken(...a),
      findFirst: (...a: unknown[]) => findFirstToken(...a),
    },
  },
}));
vi.mock("@/lib/mail", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/sms", () => ({ sendSms: (...a: unknown[]) => sendSms(...a) }));

beforeEach(() => {
  vi.clearAllMocks();
  createToken.mockResolvedValue({ id: "tok-1" });
  sendEmail.mockResolvedValue({ sent: true });
  sendSms.mockResolvedValue({ sent: true });
});

describe("requestVerification", () => {
  it("sends the code to the matched member's EXISTING email, never a newly-submitted replacement value", async () => {
    // The submission's own (untrusted) fieldValues claim a different email --
    // that must never be read by this function at all.
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "VERIFICATION_REQUIRED",
      fieldValues: { email: "attacker-controlled@evil.example" },
      matchedMember: { id: "m-1", email: "trusted@example.com", phone: null },
    });

    const { requestVerification } = await import("../verification");
    await requestVerification("org-a", "sub-1");

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "trusted@example.com" }));
    expect(sendEmail).not.toHaveBeenCalledWith(expect.objectContaining({ to: "attacker-controlled@evil.example" }));
    expect(createToken).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ destination: "trusted@example.com" }) }));
  });

  it("falls back to the member's existing phone only when no existing email is on file", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "VERIFICATION_REQUIRED",
      fieldValues: {},
      matchedMember: { id: "m-1", email: null, phone: "+12155551234" },
    });
    const { requestVerification } = await import("../verification");
    const result = await requestVerification("org-a", "sub-1");
    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: "+12155551234" }));
    expect(result.channel).toBe("SMS");
  });

  it("refuses when the matched member has no trusted email or phone on file at all", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "VERIFICATION_REQUIRED",
      fieldValues: {},
      matchedMember: { id: "m-1", email: null, phone: null },
    });
    const { requestVerification } = await import("../verification");
    await expect(requestVerification("org-a", "sub-1")).rejects.toMatchObject({ code: "MEMBER_INTAKE_VERIFICATION_NOT_APPLICABLE" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("refuses when the submission isn't in VERIFICATION_REQUIRED status", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "APPLIED",
      fieldValues: {},
      matchedMember: { id: "m-1", email: "trusted@example.com", phone: null },
    });
    const { requestVerification } = await import("../verification");
    await expect(requestVerification("org-a", "sub-1")).rejects.toMatchObject({ code: "MEMBER_INTAKE_VERIFICATION_NOT_APPLICABLE" });
  });

  it("invalidates any previously issued unconsumed token before issuing a new one", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "VERIFICATION_REQUIRED",
      fieldValues: {},
      matchedMember: { id: "m-1", email: "trusted@example.com", phone: null },
    });
    const { requestVerification } = await import("../verification");
    await requestVerification("org-a", "sub-1");
    expect(deleteManyTokens).toHaveBeenCalledWith({ where: { submissionId: "sub-1", consumedAt: null } });
  });

  it("never exposes the raw destination in the return value beyond a masked form", async () => {
    findFirstSubmission.mockResolvedValue({
      id: "sub-1",
      status: "VERIFICATION_REQUIRED",
      fieldValues: {},
      matchedMember: { id: "m-1", email: "trusted@example.com", phone: null },
    });
    const { requestVerification } = await import("../verification");
    const result = await requestVerification("org-a", "sub-1");
    expect(result.maskedDestination).not.toBe("trusted@example.com");
    expect(result.maskedDestination).toContain("@example.com");
  });
});

describe("verifySubmissionCode", () => {
  it("accepts a correct, unexpired, unconsumed code and marks it consumed + verified", async () => {
    findFirstSubmission.mockResolvedValue({ id: "sub-1", status: "VERIFICATION_REQUIRED" });
    const { hashOtpCode: realHash } = await import("@/lib/sms-otp");
    findFirstToken.mockResolvedValue({ id: "tok-1", codeHash: realHash("123456"), expiresAt: new Date(Date.now() + 60_000), attempts: 0 });

    const { verifySubmissionCode } = await import("../verification");
    const result = await verifySubmissionCode("org-a", "sub-1", "123456");

    expect(result).toEqual({ ok: true });
    expect(updateToken).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "tok-1" }, data: expect.objectContaining({ consumedAt: expect.any(Date) }) }));
    expect(updateSubmission).toHaveBeenCalledWith(expect.objectContaining({ data: { verificationStatus: "VERIFIED" } }));
  });

  it("rejects an incorrect code and increments the token's attempt counter (never the consumedAt path)", async () => {
    findFirstSubmission.mockResolvedValue({ id: "sub-1", status: "VERIFICATION_REQUIRED" });
    const { hashOtpCode: realHash } = await import("@/lib/sms-otp");
    findFirstToken.mockResolvedValue({ id: "tok-1", codeHash: realHash("123456"), expiresAt: new Date(Date.now() + 60_000), attempts: 0 });
    updateToken.mockResolvedValue({ id: "tok-1", attempts: 1 });

    const { verifySubmissionCode } = await import("../verification");
    const result = await verifySubmissionCode("org-a", "sub-1", "000000");

    expect(result).toEqual({ ok: false, error: "Invalid code. Please try again." });
    expect(updateToken).toHaveBeenCalledWith({ where: { id: "tok-1" }, data: { attempts: { increment: 1 } } });
    expect(updateToken).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ consumedAt: expect.anything() }) }));
    expect(updateSubmission).not.toHaveBeenCalled();
  });

  it("burns the token (sets consumedAt) once the attempt cap is reached, even though the code was never correct", async () => {
    findFirstSubmission.mockResolvedValue({ id: "sub-1", status: "VERIFICATION_REQUIRED" });
    const { hashOtpCode: realHash } = await import("@/lib/sms-otp");
    findFirstToken.mockResolvedValue({ id: "tok-1", codeHash: realHash("123456"), expiresAt: new Date(Date.now() + 60_000), attempts: 4 });
    // The 5th wrong guess -- the atomic increment returns attempts: 5, which hits the cap.
    updateToken.mockResolvedValue({ id: "tok-1", attempts: 5 });

    const { verifySubmissionCode } = await import("../verification");
    const result = await verifySubmissionCode("org-a", "sub-1", "000000");

    expect(result).toEqual({ ok: false, error: "Too many incorrect attempts. Request a new code." });
    expect(updateToken).toHaveBeenCalledWith({ where: { id: "tok-1" }, data: { consumedAt: expect.any(Date) } });
  });

  it("a burned token no longer resolves via findFirst's consumedAt: null filter -- a subsequent attempt sees no pending code", async () => {
    findFirstSubmission.mockResolvedValue({ id: "sub-1", status: "VERIFICATION_REQUIRED" });
    findFirstToken.mockResolvedValue(null); // simulates the burned token being excluded by consumedAt: null
    const { verifySubmissionCode } = await import("../verification");
    const result = await verifySubmissionCode("org-a", "sub-1", "123456");
    expect(result).toEqual({ ok: false, error: "No verification code is pending for this submission. Request a new one." });
  });

  it("rejects an expired code", async () => {
    findFirstSubmission.mockResolvedValue({ id: "sub-1", status: "VERIFICATION_REQUIRED" });
    const { hashOtpCode: realHash } = await import("@/lib/sms-otp");
    findFirstToken.mockResolvedValue({ id: "tok-1", codeHash: realHash("123456"), expiresAt: new Date(Date.now() - 1000), attempts: 0 });

    const { verifySubmissionCode } = await import("../verification");
    const result = await verifySubmissionCode("org-a", "sub-1", "123456");
    expect(result.ok).toBe(false);
  });

  it("rejects replay of an already-consumed code (findFirst excludes consumed tokens, so none is found)", async () => {
    findFirstSubmission.mockResolvedValue({ id: "sub-1", status: "VERIFICATION_REQUIRED" });
    findFirstToken.mockResolvedValue(null); // consumedAt: null filter means a consumed token never comes back
    const { verifySubmissionCode } = await import("../verification");
    const result = await verifySubmissionCode("org-a", "sub-1", "123456");
    expect(result.ok).toBe(false);
    expect(findFirstToken).toHaveBeenCalledWith(expect.objectContaining({ where: { submissionId: "sub-1", consumedAt: null } }));
  });
});
