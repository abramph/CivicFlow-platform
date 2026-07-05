import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashOtpCode } from "@/lib/sms-otp";

const getServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }));
vi.mock("@/lib/authOptions", () => ({ authOptions: {} }));

const findUniqueChallengeToken = vi.fn();
const findFirstChallengeToken = vi.fn();
const createChallengeToken = vi.fn();
const deleteChallengeToken = vi.fn();
const deleteManyChallengeToken = vi.fn();
const findUniqueUser = vi.fn();
const updateUser = vi.fn();
const transaction = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mfaChallengeToken: {
      findUnique: (...args: unknown[]) => findUniqueChallengeToken(...args),
      findFirst: (...args: unknown[]) => findFirstChallengeToken(...args),
      create: (...args: unknown[]) => createChallengeToken(...args),
      delete: (...args: unknown[]) => deleteChallengeToken(...args),
      deleteMany: (...args: unknown[]) => deleteManyChallengeToken(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => findUniqueUser(...args),
      update: (...args: unknown[]) => updateUser(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const sendSms = vi.fn().mockResolvedValue({ sent: true, skipped: false, to: "+15551234567" });
vi.mock("@/lib/sms", () => ({ sendSms: (...args: unknown[]) => sendSms(...args) }));

const totpVerify = vi.fn();
vi.mock("@/lib/totp", () => ({ totpVerify: (...args: unknown[]) => totpVerify(...args) }));

import { POST as sendSmsPOST } from "@/app/api/auth/mfa/send-sms/route";
import { POST as challengePOST } from "@/app/api/auth/mfa/challenge/route";
import { POST as sendVerificationPOST } from "@/app/api/auth/mfa/phone/send-verification/route";
import { POST as confirmPOST } from "@/app/api/auth/mfa/phone/confirm/route";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/mfa/send-sms", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    findUniqueChallengeToken.mockReset();
    findUniqueUser.mockReset();
    createChallengeToken.mockReset();
    deleteManyChallengeToken.mockClear();
    sendSms.mockClear();
  });

  it("rejects when there is no pending MFA challenge", async () => {
    getServerSession.mockResolvedValueOnce({ mfaPending: false });
    const response = await sendSmsPOST(jsonRequest("https://portal.test/api/auth/mfa/send-sms", {}));
    expect(response.status).toBe(401);
  });

  it("rejects when the account has no verified phone on file", async () => {
    getServerSession.mockResolvedValueOnce({ mfaPending: true, mfaUserId: "user-1", mfaTokenId: "token-1" });
    findUniqueChallengeToken.mockResolvedValueOnce({
      id: "token-1",
      type: "pending",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
    });
    findUniqueUser.mockResolvedValueOnce({ phone: null, phoneVerified: false });

    const response = await sendSmsPOST(jsonRequest("https://portal.test/api/auth/mfa/send-sms", {}));
    expect(response.status).toBe(400);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("sends a code to a verified phone and reports it masked", async () => {
    getServerSession.mockResolvedValueOnce({ mfaPending: true, mfaUserId: "user-1", mfaTokenId: "token-1" });
    findUniqueChallengeToken.mockResolvedValueOnce({
      id: "token-1",
      type: "pending",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
    });
    findUniqueUser.mockResolvedValueOnce({ phone: "+15551234567", phoneVerified: true });

    const response = await sendSmsPOST(jsonRequest("https://portal.test/api/auth/mfa/send-sms", {}));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.maskedPhone).toBe("•••••••4567");
    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: "+15551234567" }));
  });
});

describe("POST /api/auth/mfa/challenge — SMS OTP fallback", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    findUniqueChallengeToken.mockReset();
    findFirstChallengeToken.mockReset();
    findUniqueUser.mockReset();
    totpVerify.mockReset();
    deleteChallengeToken.mockClear();
    createChallengeToken.mockClear();
  });

  it("accepts a valid, unexpired SMS one-time code when TOTP verification fails", async () => {
    getServerSession.mockResolvedValueOnce({ mfaPending: true, mfaUserId: "user-1", mfaTokenId: "token-1" });
    findUniqueChallengeToken.mockResolvedValueOnce({
      id: "token-1",
      type: "pending",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
    });
    findUniqueUser.mockResolvedValueOnce({ mfaSecret: "secret", mfaBackupCodes: [] });
    totpVerify.mockReturnValueOnce(false);
    findFirstChallengeToken.mockResolvedValueOnce({
      id: "sms-token-1",
      codeHash: hashOtpCode("654321"),
      expiresAt: new Date(Date.now() + 60_000),
    });
    createChallengeToken.mockResolvedValueOnce({ token: "completion-token" });

    const response = await challengePOST(jsonRequest("https://portal.test/api/auth/mfa/challenge", { code: "654321" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.completionToken).toBe("completion-token");
    // The consumed SMS OTP token and the pending challenge token are both deleted.
    expect(deleteChallengeToken).toHaveBeenCalledWith({ where: { id: "sms-token-1" } });
    expect(deleteChallengeToken).toHaveBeenCalledWith({ where: { id: "token-1" } });
  });

  it("rejects a code that matches neither TOTP nor a pending SMS OTP", async () => {
    getServerSession.mockResolvedValueOnce({ mfaPending: true, mfaUserId: "user-1", mfaTokenId: "token-1" });
    findUniqueChallengeToken.mockResolvedValueOnce({
      id: "token-1",
      type: "pending",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
    });
    findUniqueUser.mockResolvedValueOnce({ mfaSecret: "secret", mfaBackupCodes: [] });
    totpVerify.mockReturnValueOnce(false);
    findFirstChallengeToken.mockResolvedValueOnce(null);

    const response = await challengePOST(jsonRequest("https://portal.test/api/auth/mfa/challenge", { code: "000000" }));
    expect(response.status).toBe(400);
  });
});

describe("POST /api/auth/mfa/phone/send-verification and /confirm", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    deleteManyChallengeToken.mockClear();
    createChallengeToken.mockClear();
    findFirstChallengeToken.mockReset();
    transaction.mockClear();
    sendSms.mockClear();
  });

  it("rejects an invalid phone number format", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    const response = await sendVerificationPOST(
      jsonRequest("https://portal.test/api/auth/mfa/phone/send-verification", { phone: "not-a-phone" })
    );
    expect(response.status).toBe(400);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("sends a verification code for a well-formed phone number", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    const response = await sendVerificationPOST(
      jsonRequest("https://portal.test/api/auth/mfa/phone/send-verification", { phone: "+15551234567" })
    );
    expect(response.status).toBe(200);
    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: "+15551234567" }));
  });

  it("confirms and persists the phone number when the code matches", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    findFirstChallengeToken.mockResolvedValueOnce({
      id: "verify-token-1",
      phone: "+15551234567",
      codeHash: hashOtpCode("111111"),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await confirmPOST(jsonRequest("https://portal.test/api/auth/mfa/phone/confirm", { code: "111111" }));
    expect(response.status).toBe(200);
    expect(transaction).toHaveBeenCalled();
  });

  it("rejects a wrong confirmation code", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    findFirstChallengeToken.mockResolvedValueOnce({
      id: "verify-token-1",
      phone: "+15551234567",
      codeHash: hashOtpCode("111111"),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await confirmPOST(jsonRequest("https://portal.test/api/auth/mfa/phone/confirm", { code: "999999" }));
    expect(response.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });
});
