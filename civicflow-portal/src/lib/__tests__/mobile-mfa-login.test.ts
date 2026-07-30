import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashOtpCode } from "@/lib/sms-otp";

const findUniqueUser = vi.fn();
const updateUser = vi.fn().mockResolvedValue(undefined);
const findUniqueChallengeToken = vi.fn();
const findFirstChallengeToken = vi.fn().mockResolvedValue(null);
const createChallengeToken = vi.fn().mockResolvedValue({ id: "challenge-1", token: "mfa-token-abc" });
const deleteChallengeToken = vi.fn().mockResolvedValue(undefined);
const deleteManyChallengeToken = vi.fn().mockResolvedValue(undefined);
const countMembership = vi.fn().mockResolvedValue(1);
const countPtaHouseholdAdult = vi.fn().mockResolvedValue(0);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUniqueUser(...args),
      update: (...args: unknown[]) => updateUser(...args),
    },
    mfaChallengeToken: {
      findUnique: (...args: unknown[]) => findUniqueChallengeToken(...args),
      findFirst: (...args: unknown[]) => findFirstChallengeToken(...args),
      create: (...args: unknown[]) => createChallengeToken(...args),
      delete: (...args: unknown[]) => deleteChallengeToken(...args),
      deleteMany: (...args: unknown[]) => deleteManyChallengeToken(...args),
    },
    organizationMembership: {
      count: (...args: unknown[]) => countMembership(...args),
    },
    ptaHouseholdAdult: {
      count: (...args: unknown[]) => countPtaHouseholdAdult(...args),
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const totpVerify = vi.fn();
vi.mock("@/lib/totp", () => ({ totpVerify: (...args: unknown[]) => totpVerify(...args) }));

const sendSms = vi.fn().mockResolvedValue({ sent: true, skipped: false, to: "+15551234567" });
vi.mock("@/lib/sms", () => ({ sendSms: (...args: unknown[]) => sendSms(...args) }));

const bcryptCompare = vi.fn();
vi.mock("bcryptjs", () => ({
  default: { compare: (...args: unknown[]) => bcryptCompare(...args) },
  compare: (...args: unknown[]) => bcryptCompare(...args),
}));

import { POST as loginPOST } from "@/app/api/mobile/auth/login/route";
import { POST as challengePOST } from "@/app/api/mobile/auth/mfa/challenge/route";
import { POST as sendSmsPOST } from "@/app/api/mobile/auth/mfa/send-sms/route";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/auth/login — MFA-enabled accounts", () => {
  beforeEach(() => {
    findUniqueUser.mockReset();
    bcryptCompare.mockReset();
    createChallengeToken.mockClear();
    createChallengeToken.mockResolvedValue({ id: "challenge-1", token: "mfa-token-abc" });
    countMembership.mockReset();
    countMembership.mockResolvedValue(1);
  });

  it("issues an MFA challenge token instead of full session tokens", async () => {
    findUniqueUser.mockResolvedValueOnce({
      id: "user-1",
      email: "member@example.com",
      passwordHash: "hashed",
      mfaEnabled: true,
      mobileTokenVersion: 1,
    });
    bcryptCompare.mockResolvedValueOnce(true);

    const response = await loginPOST(
      jsonRequest("https://portal.test/api/mobile/auth/login", { email: "member@example.com", password: "correct" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mfaRequired).toBe(true);
    expect(body.mfaToken).toBe("mfa-token-abc");
    expect(body.data).toBeUndefined();
  });

  it("still rejects wrong passwords before ever considering MFA", async () => {
    findUniqueUser.mockResolvedValueOnce({
      id: "user-1",
      email: "member@example.com",
      passwordHash: "hashed",
      mfaEnabled: true,
      mobileTokenVersion: 1,
    });
    bcryptCompare.mockResolvedValueOnce(false);

    const response = await loginPOST(
      jsonRequest("https://portal.test/api/mobile/auth/login", { email: "member@example.com", password: "wrong" })
    );

    expect(response.status).toBe(401);
    expect(createChallengeToken).not.toHaveBeenCalled();
  });

  it("issues full tokens directly for an account without MFA enabled", async () => {
    findUniqueUser.mockResolvedValueOnce({
      id: "user-1",
      email: "member@example.com",
      displayName: "Member One",
      passwordHash: "hashed",
      mfaEnabled: false,
      mobileTokenVersion: 1,
    });
    bcryptCompare.mockResolvedValueOnce(true);

    const response = await loginPOST(
      jsonRequest("https://portal.test/api/mobile/auth/login", { email: "member@example.com", password: "correct" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mfaRequired).toBeUndefined();
    expect(body.data.accessToken).toBeTruthy();
  });
});

describe("POST /api/mobile/auth/mfa/challenge", () => {
  beforeEach(() => {
    findUniqueChallengeToken.mockReset();
    findUniqueUser.mockReset();
    totpVerify.mockReset();
    bcryptCompare.mockReset();
    countMembership.mockReset();
    countMembership.mockResolvedValue(1);
    deleteChallengeToken.mockClear();
    findFirstChallengeToken.mockReset();
    findFirstChallengeToken.mockResolvedValue(null);
  });

  it("rejects when the challenge token is missing or expired", async () => {
    findUniqueChallengeToken.mockResolvedValueOnce(null);
    const response = await challengePOST(
      jsonRequest("https://portal.test/api/mobile/auth/mfa/challenge", { mfaToken: "bad-token", code: "123456" })
    );
    expect(response.status).toBe(401);
  });

  it("issues real tokens on a valid TOTP code", async () => {
    findUniqueChallengeToken.mockResolvedValueOnce({
      id: "challenge-1",
      userId: "user-1",
      type: "pending",
      expiresAt: new Date(Date.now() + 60_000),
    });
    findUniqueUser.mockResolvedValueOnce({
      id: "user-1",
      email: "member@example.com",
      displayName: "Member One",
      mobileTokenVersion: 1,
      mfaSecret: "secret",
      mfaBackupCodes: [],
    });
    totpVerify.mockReturnValueOnce(true);

    const response = await challengePOST(
      jsonRequest("https://portal.test/api/mobile/auth/mfa/challenge", { mfaToken: "mfa-token-abc", code: "123456" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.accessToken).toBeTruthy();
    expect(deleteChallengeToken).toHaveBeenCalledWith({ where: { id: "challenge-1" } });
  });

  it("rejects an invalid code without issuing tokens", async () => {
    findUniqueChallengeToken.mockResolvedValueOnce({
      id: "challenge-1",
      userId: "user-1",
      type: "pending",
      expiresAt: new Date(Date.now() + 60_000),
    });
    findUniqueUser.mockResolvedValueOnce({
      id: "user-1",
      email: "member@example.com",
      displayName: "Member One",
      mobileTokenVersion: 1,
      mfaSecret: "secret",
      mfaBackupCodes: [],
    });
    totpVerify.mockReturnValueOnce(false);

    const response = await challengePOST(
      jsonRequest("https://portal.test/api/mobile/auth/mfa/challenge", { mfaToken: "mfa-token-abc", code: "000000" })
    );

    expect(response.status).toBe(400);
    expect(deleteChallengeToken).not.toHaveBeenCalled();
  });

  it("accepts a valid SMS OTP fallback code", async () => {
    findUniqueChallengeToken.mockResolvedValueOnce({
      id: "challenge-1",
      userId: "user-1",
      type: "pending",
      expiresAt: new Date(Date.now() + 60_000),
    });
    findUniqueUser.mockResolvedValueOnce({
      id: "user-1",
      email: "member@example.com",
      displayName: "Member One",
      mobileTokenVersion: 1,
      mfaSecret: "secret",
      mfaBackupCodes: [],
    });
    totpVerify.mockReturnValueOnce(false);
    findFirstChallengeToken.mockResolvedValueOnce({
      id: "sms-otp-1",
      codeHash: hashOtpCode("654321"),
      createdAt: new Date(),
    });

    const response = await challengePOST(
      jsonRequest("https://portal.test/api/mobile/auth/mfa/challenge", { mfaToken: "mfa-token-abc", code: "654321" })
    );

    expect(response.status).toBe(200);
  });

  it("rejects a valid code if the account has no active mobile membership", async () => {
    findUniqueChallengeToken.mockResolvedValueOnce({
      id: "challenge-1",
      userId: "user-1",
      type: "pending",
      expiresAt: new Date(Date.now() + 60_000),
    });
    findUniqueUser.mockResolvedValueOnce({
      id: "user-1",
      email: "member@example.com",
      displayName: "Member One",
      mobileTokenVersion: 1,
      mfaSecret: "secret",
      mfaBackupCodes: [],
    });
    totpVerify.mockReturnValueOnce(true);
    countMembership.mockResolvedValueOnce(0);

    const response = await challengePOST(
      jsonRequest("https://portal.test/api/mobile/auth/mfa/challenge", { mfaToken: "mfa-token-abc", code: "123456" })
    );

    expect(response.status).toBe(403);
  });
});

describe("POST /api/mobile/auth/mfa/send-sms", () => {
  beforeEach(() => {
    findUniqueChallengeToken.mockReset();
    findUniqueUser.mockReset();
    sendSms.mockClear();
  });

  it("rejects when the challenge token is missing or expired", async () => {
    findUniqueChallengeToken.mockResolvedValueOnce(null);
    const response = await sendSmsPOST(
      jsonRequest("https://portal.test/api/mobile/auth/mfa/send-sms", { mfaToken: "bad-token" })
    );
    expect(response.status).toBe(401);
  });

  it("sends a code and returns a masked phone for a verified phone on file", async () => {
    findUniqueChallengeToken.mockResolvedValueOnce({
      id: "challenge-1",
      userId: "user-1",
      type: "pending",
      expiresAt: new Date(Date.now() + 60_000),
    });
    findUniqueUser.mockResolvedValueOnce({ phone: "+15551234567", phoneVerified: true });

    const response = await sendSmsPOST(
      jsonRequest("https://portal.test/api/mobile/auth/mfa/send-sms", { mfaToken: "mfa-token-abc" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.maskedPhone).toBeTruthy();
    expect(sendSms).toHaveBeenCalled();
  });

  it("rejects when there's no verified phone on file", async () => {
    findUniqueChallengeToken.mockResolvedValueOnce({
      id: "challenge-1",
      userId: "user-1",
      type: "pending",
      expiresAt: new Date(Date.now() + 60_000),
    });
    findUniqueUser.mockResolvedValueOnce({ phone: null, phoneVerified: false });

    const response = await sendSmsPOST(
      jsonRequest("https://portal.test/api/mobile/auth/mfa/send-sms", { mfaToken: "mfa-token-abc" })
    );

    expect(response.status).toBe(400);
    expect(sendSms).not.toHaveBeenCalled();
  });
});
