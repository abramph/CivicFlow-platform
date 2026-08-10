import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveTwilioCredentials = vi.fn();
const getPlatformSmsSettings = vi.fn();
vi.mock("@/lib/sms-credentials", () => ({
  getEffectiveTwilioCredentials: (...args: unknown[]) => getEffectiveTwilioCredentials(...args),
  getPlatformSmsSettings: (...args: unknown[]) => getPlatformSmsSettings(...args),
}));

import { isSmsConfigured, sendSms } from "@/lib/sms";

const originalEnv = { ...process.env };

function enabledSettings(overrides: Record<string, unknown> = {}) {
  return {
    platformEnabled: true,
    testMode: false,
    maintenanceMode: false,
    outboundPaused: false,
    testPhoneNumbers: [] as string[],
    ...overrides,
  };
}

function credentials(overrides: Record<string, unknown> = {}) {
  return {
    accountSid: "ACxxxx",
    authToken: "auth-token",
    apiKey: null,
    apiSecret: null,
    messagingServiceSid: null,
    fromNumber: "+15550000000",
    source: "database",
    ...overrides,
  };
}

describe("isSmsConfigured / sendSms", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getEffectiveTwilioCredentials.mockReset();
    getPlatformSmsSettings.mockReset();
    process.env.NEXTAUTH_URL = "https://app.example.com";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reports unconfigured and skips sending when no credentials resolve", async () => {
    getEffectiveTwilioCredentials.mockResolvedValue(null);
    getPlatformSmsSettings.mockResolvedValue(enabledSettings());

    expect(await isSmsConfigured()).toBe(false);
    const result = await sendSms({ to: "+15551234567", body: "hello" });
    expect(result).toEqual({ sent: false, skipped: true, reason: "SMS delivery is not configured", to: "+15551234567" });
  });

  it("skips with a clear reason when the platform is disabled", async () => {
    getEffectiveTwilioCredentials.mockResolvedValue(credentials());
    getPlatformSmsSettings.mockResolvedValue(enabledSettings({ platformEnabled: false }));

    const result = await sendSms({ to: "+15551234567", body: "hello" });
    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/disabled/i);
  });

  it("skips with a clear reason when in maintenance mode", async () => {
    getEffectiveTwilioCredentials.mockResolvedValue(credentials());
    getPlatformSmsSettings.mockResolvedValue(enabledSettings({ maintenanceMode: true }));

    const result = await sendSms({ to: "+15551234567", body: "hello" });
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/maintenance/i);
  });

  it("skips with a clear reason when outbound is paused", async () => {
    getEffectiveTwilioCredentials.mockResolvedValue(credentials());
    getPlatformSmsSettings.mockResolvedValue(enabledSettings({ outboundPaused: true }));

    const result = await sendSms({ to: "+15551234567", body: "hello" });
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/paused/i);
  });

  it("Safe Launch Mode: in test mode, only allowlisted numbers get sent to", async () => {
    getEffectiveTwilioCredentials.mockResolvedValue(credentials());
    getPlatformSmsSettings.mockResolvedValue(enabledSettings({ testMode: true, testPhoneNumbers: ["+15559999999"] }));

    const blocked = await sendSms({ to: "+15551234567", body: "hello" });
    expect(blocked.skipped).toBe(true);
    expect(blocked.reason).toMatch(/Safe Launch Mode/);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SM1" }) }));
    const allowed = await sendSms({ to: "+15559999999", body: "hello" });
    expect(allowed.sent).toBe(true);
  });

  it("sends via Twilio's REST API using a From number when no Messaging Service SID is configured", async () => {
    getEffectiveTwilioCredentials.mockResolvedValue(credentials());
    getPlatformSmsSettings.mockResolvedValue(enabledSettings());

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SM123" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendSms({ to: "+15551234567", body: "your code is 123456" });

    expect(result).toEqual({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM123" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.twilio.com/2010-04-01/Accounts/ACxxxx/Messages.json",
      expect.objectContaining({ method: "POST" })
    );
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("From")).toBe("+15550000000");
    expect(body.get("MessagingServiceSid")).toBeNull();
    expect(body.get("StatusCallback")).toBe("https://app.example.com/api/webhooks/twilio/status");
  });

  it("uses MessagingServiceSid instead of From when one is configured", async () => {
    getEffectiveTwilioCredentials.mockResolvedValue(credentials({ messagingServiceSid: "MGxxxx" }));
    getPlatformSmsSettings.mockResolvedValue(enabledSettings());

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SM123" }) });
    vi.stubGlobal("fetch", fetchMock);

    await sendSms({ to: "+15551234567", body: "hi" });

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("MessagingServiceSid")).toBe("MGxxxx");
    expect(body.get("From")).toBeNull();
  });

  it("surfaces a Twilio API error instead of throwing, and logs it structurally without phone/message PII", async () => {
    getEffectiveTwilioCredentials.mockResolvedValue(credentials());
    getPlatformSmsSettings.mockResolvedValue(enabledSettings());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: "Invalid To number", code: 21211 }) })
    );

    const result = await sendSms({ to: "+15551234567", body: "your one-time code is 123456" });
    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.reason).toBe("Invalid To number");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged.event).toBe("sms_send_failed");
    expect(logged.status).toBe(400);
    expect(logged.providerCode).toBe(21211);
    expect(logged.to).toBeUndefined();
    expect(logged.providerMessage).toBeUndefined();
    expect(JSON.stringify(logged)).not.toMatch(/5551234567|4567|Invalid To number/);
    expect(JSON.stringify(logged)).not.toMatch(/your one-time code/); // never the message body
  });

  it("logs a structured failure event when the Twilio request itself throws (network error)", async () => {
    getEffectiveTwilioCredentials.mockResolvedValue(credentials());
    getPlatformSmsSettings.mockResolvedValue(enabledSettings());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unreachable")));

    const result = await sendSms({ to: "+15551234567", body: "hi" });
    expect(result.sent).toBe(false);
    expect(result.reason).toBe("network unreachable");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged.event).toBe("sms_send_failed");
    expect(logged.errorName).toBe("Error");
    expect(logged.to).toBeUndefined();
    expect(logged.error).toBeUndefined();
  });
});
