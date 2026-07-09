import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    platformSmsSettings: {
      findFirst: (...args: unknown[]) => findFirst(...args),
      create: (...args: unknown[]) => create(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

import { encryptSecret } from "@/lib/crypto-secrets";
import {
  getEffectiveTwilioCredentials,
  getMaskedSmsCredentialsView,
  getPlatformSmsSettings,
  updatePlatformSmsCredentials,
} from "@/lib/sms-credentials";

const originalEnv = { ...process.env };

function emptySettings(overrides: Record<string, unknown> = {}) {
  return {
    id: "settings-1",
    platformEnabled: false,
    testMode: true,
    maintenanceMode: false,
    outboundPaused: false,
    mfaSmsEnabled: true,
    orgMessagingEnabled: false,
    accountSidEncrypted: null,
    authTokenEncrypted: null,
    apiKeyEncrypted: null,
    apiSecretEncrypted: null,
    messagingServiceSidEncrypted: null,
    tollFreeNumberEncrypted: null,
    verifyServiceSidEncrypted: null,
    tollFreeVerificationSid: null,
    tollFreeVerificationStatus: "NOT_SUBMITTED",
    tollFreeVerificationSubmittedAt: null,
    tollFreeVerificationApprovedAt: null,
    tollFreeVerificationLastCheckedAt: null,
    testPhoneNumbers: [],
    carrierFeePercent: 0,
    updatedByUserId: null,
    ...overrides,
  };
}

describe("sms-credentials", () => {
  beforeEach(() => {
    findFirst.mockReset();
    create.mockReset();
    update.mockReset();
    process.env.SMS_CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.SMS_API_KEY;
    delete process.env.SMS_FROM_NUMBER;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("getPlatformSmsSettings", () => {
    it("creates the singleton row if none exists", async () => {
      findFirst.mockResolvedValueOnce(null);
      create.mockResolvedValueOnce(emptySettings());

      const settings = await getPlatformSmsSettings();

      expect(create).toHaveBeenCalledWith({ data: {} });
      expect(settings.id).toBe("settings-1");
    });

    it("returns the existing row without creating a new one", async () => {
      findFirst.mockResolvedValueOnce(emptySettings());
      await getPlatformSmsSettings();
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("getEffectiveTwilioCredentials", () => {
    it("falls back to env vars when no database credentials are configured", async () => {
      findFirst.mockResolvedValueOnce(emptySettings());
      process.env.TWILIO_ACCOUNT_SID = "ACenv";
      process.env.SMS_API_KEY = "env-token";
      process.env.SMS_FROM_NUMBER = "+15550001111";

      const result = await getEffectiveTwilioCredentials();

      expect(result).toEqual({
        accountSid: "ACenv",
        authToken: "env-token",
        apiKey: null,
        apiSecret: null,
        messagingServiceSid: null,
        fromNumber: "+15550001111",
        source: "env",
      });
    });

    it("returns null when neither database nor env credentials are configured", async () => {
      findFirst.mockResolvedValueOnce(emptySettings());
      const result = await getEffectiveTwilioCredentials();
      expect(result).toBeNull();
    });

    it("prefers database credentials over env vars when both are present", async () => {
      process.env.TWILIO_ACCOUNT_SID = "ACenv";
      process.env.SMS_API_KEY = "env-token";
      findFirst.mockResolvedValueOnce(
        emptySettings({
          accountSidEncrypted: encryptSecret("ACdatabase"),
          authTokenEncrypted: encryptSecret("db-token"),
          messagingServiceSidEncrypted: encryptSecret("MGdatabase"),
        })
      );

      const result = await getEffectiveTwilioCredentials();

      expect(result?.source).toBe("database");
      expect(result?.accountSid).toBe("ACdatabase");
      expect(result?.authToken).toBe("db-token");
      expect(result?.messagingServiceSid).toBe("MGdatabase");
    });
  });

  describe("updatePlatformSmsCredentials", () => {
    it("encrypts provided fields and leaves omitted fields untouched", async () => {
      findFirst.mockResolvedValueOnce(emptySettings());
      update.mockResolvedValueOnce(emptySettings());

      await updatePlatformSmsCredentials({ accountSid: "ACnew", authToken: "new-token" }, "user-1");

      expect(update).toHaveBeenCalledTimes(1);
      const call = update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "settings-1" });
      expect(call.data.updatedByUserId).toBe("user-1");
      expect(call.data.accountSidEncrypted).toEqual(expect.any(String));
      expect(call.data.authTokenEncrypted).toEqual(expect.any(String));
      expect(call.data.apiKeyEncrypted).toBeUndefined();
    });

    it("clears a field when explicitly passed null", async () => {
      findFirst.mockResolvedValueOnce(emptySettings());
      update.mockResolvedValueOnce(emptySettings());

      await updatePlatformSmsCredentials({ apiKey: null }, "user-1");

      const call = update.mock.calls[0][0];
      expect(call.data.apiKeyEncrypted).toBeNull();
    });
  });

  describe("getMaskedSmsCredentialsView", () => {
    it("never exposes authToken/apiSecret, even masked", async () => {
      findFirst.mockResolvedValueOnce(
        emptySettings({
          accountSidEncrypted: encryptSecret("AC1234567890abcdef"),
          authTokenEncrypted: encryptSecret("super-secret-token"),
          apiSecretEncrypted: encryptSecret("super-secret-api-secret"),
        })
      );

      const view = await getMaskedSmsCredentialsView();

      expect(view.accountSid).toBe("••••••••••••••cdef");
      expect(view.authTokenConfigured).toBe(true);
      expect(view.apiSecretConfigured).toBe(true);
      expect(JSON.stringify(view)).not.toContain("super-secret");
      expect(view.source).toBe("database");
    });

    it("reports unconfigured when nothing is set anywhere", async () => {
      findFirst.mockResolvedValueOnce(emptySettings());
      const view = await getMaskedSmsCredentialsView();
      expect(view.source).toBe("unconfigured");
      expect(view.accountSid).toBeNull();
    });
  });
});
