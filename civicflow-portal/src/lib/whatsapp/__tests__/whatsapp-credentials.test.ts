import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const create = vi.fn();
const update = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    platformWhatsAppSettings: {
      findFirst: (...args: unknown[]) => findFirst(...args),
      create: (...args: unknown[]) => create(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

const getEffectiveTwilioCredentials = vi.fn();
vi.mock("@/lib/sms-credentials", () => ({
  getEffectiveTwilioCredentials: () => getEffectiveTwilioCredentials(),
}));

import { encryptSecret } from "@/lib/crypto-secrets";
import {
  getEffectiveWhatsAppSender,
  getMaskedWhatsAppSettingsView,
  getPlatformWhatsAppSettings,
  updatePlatformWhatsAppSettings,
} from "@/lib/whatsapp/credentials";

const originalEnv = { ...process.env };

function emptySettings(overrides: Record<string, unknown> = {}) {
  return {
    id: "wa-settings-1",
    platformEnabled: false,
    sandboxMode: true,
    maintenanceMode: false,
    outboundPaused: false,
    orgMessagingEnabled: false,
    fromNumberEncrypted: null,
    messagingServiceSidEncrypted: null,
    testPhoneNumbers: [],
    updatedByUserId: null,
    ...overrides,
  };
}

const ACCOUNT_CREDENTIALS = {
  accountSid: "ACtest",
  authToken: "test-token",
  apiKey: null,
  apiSecret: null,
  messagingServiceSid: null,
  fromNumber: null,
  source: "database" as const,
};

describe("whatsapp-credentials", () => {
  beforeEach(() => {
    findFirst.mockReset();
    create.mockReset();
    update.mockReset();
    getEffectiveTwilioCredentials.mockReset();
    process.env.SMS_CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    delete process.env.WHATSAPP_SANDBOX_FROM_NUMBER;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("getPlatformWhatsAppSettings", () => {
    it("creates the singleton row if none exists", async () => {
      findFirst.mockResolvedValueOnce(null);
      create.mockResolvedValueOnce(emptySettings());

      const settings = await getPlatformWhatsAppSettings();

      expect(create).toHaveBeenCalledWith({ data: {} });
      expect(settings.id).toBe("wa-settings-1");
    });

    it("returns the existing row without creating a new one", async () => {
      findFirst.mockResolvedValueOnce(emptySettings());
      await getPlatformWhatsAppSettings();
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("getEffectiveWhatsAppSender", () => {
    it("returns null when there are no Twilio account credentials at all — never reached its own sender config", async () => {
      getEffectiveTwilioCredentials.mockResolvedValueOnce(null);
      const result = await getEffectiveWhatsAppSender();
      expect(result).toBeNull();
      expect(findFirst).not.toHaveBeenCalled();
    });

    it("falls back to WHATSAPP_SANDBOX_FROM_NUMBER when no sender is configured in the database", async () => {
      getEffectiveTwilioCredentials.mockResolvedValueOnce(ACCOUNT_CREDENTIALS);
      findFirst.mockResolvedValueOnce(emptySettings());
      process.env.WHATSAPP_SANDBOX_FROM_NUMBER = "+14155238886";

      const result = await getEffectiveWhatsAppSender();

      expect(result).toEqual({
        accountSid: "ACtest",
        authToken: "test-token",
        messagingServiceSid: null,
        fromNumber: "+14155238886",
        credentialsSource: "database",
        senderSource: "env",
      });
    });

    it("reports unconfigured when neither a database sender nor the env fallback is set", async () => {
      getEffectiveTwilioCredentials.mockResolvedValueOnce(ACCOUNT_CREDENTIALS);
      findFirst.mockResolvedValueOnce(emptySettings());

      const result = await getEffectiveWhatsAppSender();

      expect(result?.senderSource).toBe("unconfigured");
      expect(result?.fromNumber).toBeNull();
    });

    it("prefers a database-configured sender over the env fallback", async () => {
      getEffectiveTwilioCredentials.mockResolvedValueOnce(ACCOUNT_CREDENTIALS);
      process.env.WHATSAPP_SANDBOX_FROM_NUMBER = "+14155238886";
      findFirst.mockResolvedValueOnce(
        emptySettings({
          fromNumberEncrypted: encryptSecret("+15559990000"),
          messagingServiceSidEncrypted: encryptSecret("MGdatabase"),
        })
      );

      const result = await getEffectiveWhatsAppSender();

      expect(result?.senderSource).toBe("database");
      expect(result?.fromNumber).toBe("+15559990000");
      expect(result?.messagingServiceSid).toBe("MGdatabase");
    });

    it("reuses the SMS account credentials verbatim — never a second copy", async () => {
      getEffectiveTwilioCredentials.mockResolvedValueOnce({ ...ACCOUNT_CREDENTIALS, source: "env" });
      findFirst.mockResolvedValueOnce(emptySettings());

      const result = await getEffectiveWhatsAppSender();

      expect(result?.accountSid).toBe(ACCOUNT_CREDENTIALS.accountSid);
      expect(result?.authToken).toBe(ACCOUNT_CREDENTIALS.authToken);
      expect(result?.credentialsSource).toBe("env");
    });
  });

  describe("updatePlatformWhatsAppSettings", () => {
    it("encrypts provided fields and leaves omitted fields untouched", async () => {
      findFirst.mockResolvedValueOnce(emptySettings());
      update.mockResolvedValueOnce(emptySettings());

      await updatePlatformWhatsAppSettings({ fromNumber: "+15551234567" }, "user-1");

      expect(update).toHaveBeenCalledTimes(1);
      const call = update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "wa-settings-1" });
      expect(call.data.updatedByUserId).toBe("user-1");
      expect(call.data.fromNumberEncrypted).toEqual(expect.any(String));
      expect(call.data.messagingServiceSidEncrypted).toBeUndefined();
    });

    it("clears a field when explicitly passed null", async () => {
      findFirst.mockResolvedValueOnce(emptySettings());
      update.mockResolvedValueOnce(emptySettings());

      await updatePlatformWhatsAppSettings({ messagingServiceSid: null }, "user-1");

      const call = update.mock.calls[0][0];
      expect(call.data.messagingServiceSidEncrypted).toBeNull();
    });

    it.each([
      "platformEnabled",
      "sandboxMode",
      "maintenanceMode",
      "outboundPaused",
      "orgMessagingEnabled",
    ] as const)("sets %s independently, leaving other toggles untouched", async (field) => {
      findFirst.mockResolvedValueOnce(emptySettings());
      update.mockResolvedValueOnce(emptySettings());

      await updatePlatformWhatsAppSettings({ [field]: true }, "user-1");

      const call = update.mock.calls[0][0];
      expect(call.data[field]).toBe(true);
      const otherToggles = ["platformEnabled", "sandboxMode", "maintenanceMode", "outboundPaused", "orgMessagingEnabled"].filter(
        (f) => f !== field
      );
      for (const other of otherToggles) {
        expect(call.data[other]).toBeUndefined();
      }
    });

    it("sets testPhoneNumbers independently of the toggles and sender fields", async () => {
      findFirst.mockResolvedValueOnce(emptySettings());
      update.mockResolvedValueOnce(emptySettings());

      await updatePlatformWhatsAppSettings({ testPhoneNumbers: ["+15551112222", "+15553334444"] }, "user-1");

      const call = update.mock.calls[0][0];
      expect(call.data.testPhoneNumbers).toEqual(["+15551112222", "+15553334444"]);
      expect(call.data.fromNumberEncrypted).toBeUndefined();
      expect(call.data.platformEnabled).toBeUndefined();
    });

    it("combines sender-field and toggle updates in a single call", async () => {
      findFirst.mockResolvedValueOnce(emptySettings());
      update.mockResolvedValueOnce(emptySettings());

      await updatePlatformWhatsAppSettings({ fromNumber: "+15551234567", maintenanceMode: true }, "user-1");

      const call = update.mock.calls[0][0];
      expect(call.data.fromNumberEncrypted).toEqual(expect.any(String));
      expect(call.data.maintenanceMode).toBe(true);
    });
  });

  describe("getMaskedWhatsAppSettingsView", () => {
    it("never exposes the raw auth token, even indirectly", async () => {
      getEffectiveTwilioCredentials.mockResolvedValue({ ...ACCOUNT_CREDENTIALS, authToken: "super-secret-token" });
      findFirst.mockResolvedValue(
        emptySettings({ fromNumberEncrypted: encryptSecret("+15551234567"), sandboxMode: false })
      );

      const view = await getMaskedWhatsAppSettingsView();

      expect(view.fromNumber).toBe("+15551234567");
      expect(view.sandboxMode).toBe(false);
      expect(JSON.stringify(view)).not.toContain("super-secret-token");
    });
  });
});
