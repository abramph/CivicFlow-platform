import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveTwilioCredentials = vi.fn();
const getPlatformSmsSettings = vi.fn();
vi.mock("@/lib/sms-credentials", () => ({
  getEffectiveTwilioCredentials: (...args: unknown[]) => getEffectiveTwilioCredentials(...args),
  getPlatformSmsSettings: (...args: unknown[]) => getPlatformSmsSettings(...args),
}));

import { isSmsConfigured, sendSms } from "@/lib/sms";

const originalEnv = { ...process.env };

// A syntactically valid Twilio message SID (SM + 32 hex chars) — anything
// less on a 2xx response is an ambiguous outcome, not a send.
const VALID_SID = "SM0123456789abcdef0123456789abcdef";

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
    expect(result).toEqual({ sent: false, skipped: true, outcome: "definitive_failure", reason: "SMS delivery is not configured", to: "+15551234567" });
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

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: VALID_SID }) }));
    const allowed = await sendSms({ to: "+15559999999", body: "hello" });
    expect(allowed.sent).toBe(true);
  });

  it("sends via Twilio's REST API using a From number when no Messaging Service SID is configured", async () => {
    getEffectiveTwilioCredentials.mockResolvedValue(credentials());
    getPlatformSmsSettings.mockResolvedValue(enabledSettings());

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: VALID_SID }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendSms({ to: "+15551234567", body: "your code is 123456" });

    expect(result).toEqual({ sent: true, skipped: false, outcome: "sent", to: "+15551234567", providerMessageId: VALID_SID });
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

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: VALID_SID }) });
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
    expect(result.outcome).toBe("definitive_failure"); // Twilio answered: provably not accepted
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

  it("AMBIGUOUS: a thrown transport error (connection reset) is outcome 'unknown' — never described as a provider rejection — with an honest reason and a PII-free log", async () => {
    getEffectiveTwilioCredentials.mockResolvedValue(credentials());
    getPlatformSmsSettings.mockResolvedValue(enabledSettings());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("read ECONNRESET")));

    const result = await sendSms({ to: "+15551234567", body: "hi" });
    expect(result.sent).toBe(false);
    expect(result.outcome).toBe("unknown");
    expect(result.reason).toBe("Delivery outcome is unknown; verify in Twilio before retrying.");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged.event).toBe("sms_send_outcome_unknown");
    expect(logged.errorName).toBe("Error");
    expect(logged.to).toBeUndefined();
    expect(logged.error).toBeUndefined();
    expect(JSON.stringify(logged)).not.toMatch(/5551234567/);
  });

  it("AMBIGUOUS: a timeout/abort of the Twilio request is outcome 'unknown' — acceptance cannot be proven either way", async () => {
    getEffectiveTwilioCredentials.mockResolvedValue(credentials());
    getPlatformSmsSettings.mockResolvedValue(enabledSettings());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const abortError = new Error("The operation was aborted due to timeout");
    abortError.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const result = await sendSms({ to: "+15551234567", body: "hi" });
    expect(result.outcome).toBe("unknown");
    expect(result.reason).toBe("Delivery outcome is unknown; verify in Twilio before retrying.");

    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged.event).toBe("sms_send_outcome_unknown");
    expect(logged.errorName).toBe("TimeoutError");
  });

  it("SID VALIDATION: a 2xx with a VALID Twilio SID is 'sent' with that SID as the provider identity", async () => {
    getEffectiveTwilioCredentials.mockResolvedValue(credentials());
    getPlatformSmsSettings.mockResolvedValue(enabledSettings());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ sid: VALID_SID }) }));

    const result = await sendSms({ to: "+15551234567", body: "hi" });
    expect(result.outcome).toBe("sent");
    expect(result.providerMessageId).toBe(VALID_SID);
  });

  it.each([
    ["malformed JSON", { ok: true, status: 201, json: async () => { throw new Error("bad json"); } }],
    ["missing SID", { ok: true, status: 201, json: async () => ({}) }],
    ["blank SID", { ok: true, status: 201, json: async () => ({ sid: "   " }) }],
    ["invalid SID format", { ok: true, status: 201, json: async () => ({ sid: "SM1" }) }],
  ])("SID VALIDATION: a 2xx with %s is outcome 'unknown' — acceptance may have occurred but cannot be reconciled — with a PII-free log", async (_label, response) => {
    getEffectiveTwilioCredentials.mockResolvedValue(credentials());
    getPlatformSmsSettings.mockResolvedValue(enabledSettings());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const result = await sendSms({ to: "+15551234567", body: "your one-time code is 123456" });

    expect(result.sent).toBe(false);
    expect(result.outcome).toBe("unknown");
    expect(result.reason).toBe("Delivery outcome is unknown; verify in Twilio before retrying.");
    expect(result.providerMessageId).toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged.event).toBe("sms_send_outcome_unknown");
    expect(logged.cause).toBe("missing_or_invalid_message_sid");
    expect(JSON.stringify(logged)).not.toMatch(/5551234567|one-time code/);
  });

  it("platform gates report outcome 'definitive_failure' — the request was never attempted, so quota handling may treat it as a provable non-send", async () => {
    getEffectiveTwilioCredentials.mockResolvedValue(credentials());
    getPlatformSmsSettings.mockResolvedValue(enabledSettings({ outboundPaused: true }));

    const result = await sendSms({ to: "+15551234567", body: "hi" });
    expect(result.outcome).toBe("definitive_failure");
    expect(result.skipped).toBe(true);
  });
});
