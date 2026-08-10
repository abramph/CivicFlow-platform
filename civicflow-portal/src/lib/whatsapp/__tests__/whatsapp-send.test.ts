import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveWhatsAppSender = vi.fn();
const getPlatformWhatsAppSettings = vi.fn();
vi.mock("@/lib/whatsapp/credentials", () => ({
  getEffectiveWhatsAppSender: (...args: unknown[]) => getEffectiveWhatsAppSender(...args),
  getPlatformWhatsAppSettings: (...args: unknown[]) => getPlatformWhatsAppSettings(...args),
}));

import { isWhatsAppConfigured, sendWhatsAppMessage } from "@/lib/whatsapp/send";

const originalEnv = { ...process.env };

function enabledSettings(overrides: Record<string, unknown> = {}) {
  return {
    platformEnabled: true,
    sandboxMode: false,
    maintenanceMode: false,
    outboundPaused: false,
    testPhoneNumbers: [] as string[],
    ...overrides,
  };
}

function sender(overrides: Record<string, unknown> = {}) {
  return {
    accountSid: "ACxxxx",
    authToken: "auth-token",
    messagingServiceSid: null,
    fromNumber: "+14155238886",
    credentialsSource: "database",
    senderSource: "database",
    ...overrides,
  };
}

describe("isWhatsAppConfigured / sendWhatsAppMessage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getEffectiveWhatsAppSender.mockReset();
    getPlatformWhatsAppSettings.mockReset();
    process.env.NEXTAUTH_URL = "https://app.example.com";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when called with neither contentSid nor body", async () => {
    await expect(sendWhatsAppMessage({ to: "+15551234567" })).rejects.toThrow();
  });

  it("throws when called with both contentSid and body", async () => {
    await expect(
      sendWhatsAppMessage({ to: "+15551234567", contentSid: "HXtest", body: "hi" })
    ).rejects.toThrow();
  });

  it("reports unconfigured and skips sending when no sender resolves", async () => {
    getEffectiveWhatsAppSender.mockResolvedValue(null);
    getPlatformWhatsAppSettings.mockResolvedValue(enabledSettings());

    expect(await isWhatsAppConfigured()).toBe(false);
    const result = await sendWhatsAppMessage({ to: "+15551234567", body: "hello" });
    expect(result).toEqual({ sent: false, skipped: true, reason: "WhatsApp delivery is not configured", to: "+15551234567" });
  });

  it("skips with a clear reason when the platform is disabled", async () => {
    getEffectiveWhatsAppSender.mockResolvedValue(sender());
    getPlatformWhatsAppSettings.mockResolvedValue(enabledSettings({ platformEnabled: false }));

    const result = await sendWhatsAppMessage({ to: "+15551234567", body: "hello" });
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/disabled/i);
  });

  it("skips with a clear reason when in maintenance mode", async () => {
    getEffectiveWhatsAppSender.mockResolvedValue(sender());
    getPlatformWhatsAppSettings.mockResolvedValue(enabledSettings({ maintenanceMode: true }));

    const result = await sendWhatsAppMessage({ to: "+15551234567", body: "hello" });
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/maintenance/i);
  });

  it("skips with a clear reason when outbound is paused", async () => {
    getEffectiveWhatsAppSender.mockResolvedValue(sender());
    getPlatformWhatsAppSettings.mockResolvedValue(enabledSettings({ outboundPaused: true }));

    const result = await sendWhatsAppMessage({ to: "+15551234567", body: "hello" });
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/paused/i);
  });

  it("sandbox mode: only allowlisted test numbers get sent to", async () => {
    getEffectiveWhatsAppSender.mockResolvedValue(sender());
    getPlatformWhatsAppSettings.mockResolvedValue(enabledSettings({ sandboxMode: true, testPhoneNumbers: ["+15559999999"] }));

    const blocked = await sendWhatsAppMessage({ to: "+15551234567", body: "hello" });
    expect(blocked.skipped).toBe(true);
    expect(blocked.reason).toMatch(/Sandbox mode/);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SM1" }) }));
    const allowed = await sendWhatsAppMessage({ to: "+15559999999", body: "hello" });
    expect(allowed.sent).toBe(true);
  });

  it("prefixes whatsapp: on both To and From, and sends a freeform Body", async () => {
    getEffectiveWhatsAppSender.mockResolvedValue(sender());
    getPlatformWhatsAppSettings.mockResolvedValue(enabledSettings());

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SM123" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWhatsAppMessage({ to: "+15551234567", body: "hello" });

    expect(result).toEqual({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM123" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.twilio.com/2010-04-01/Accounts/ACxxxx/Messages.json",
      expect.objectContaining({ method: "POST" })
    );
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("To")).toBe("whatsapp:+15551234567");
    expect(body.get("From")).toBe("whatsapp:+14155238886");
    expect(body.get("Body")).toBe("hello");
    expect(body.get("ContentSid")).toBeNull();
    expect(body.get("StatusCallback")).toBe("https://app.example.com/api/webhooks/twilio/whatsapp/status");
  });

  it("uses MessagingServiceSid instead of From when one is configured", async () => {
    getEffectiveWhatsAppSender.mockResolvedValue(sender({ messagingServiceSid: "MGxxxx" }));
    getPlatformWhatsAppSettings.mockResolvedValue(enabledSettings());

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SM123" }) });
    vi.stubGlobal("fetch", fetchMock);

    await sendWhatsAppMessage({ to: "+15551234567", body: "hi" });

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("MessagingServiceSid")).toBe("MGxxxx");
    expect(body.get("From")).toBeNull();
  });

  it("sends ContentSid + ContentVariables for a template message, with no Body", async () => {
    getEffectiveWhatsAppSender.mockResolvedValue(sender());
    getPlatformWhatsAppSettings.mockResolvedValue(enabledSettings());

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SM123" }) });
    vi.stubGlobal("fetch", fetchMock);

    await sendWhatsAppMessage({ to: "+15551234567", contentSid: "HXtest", contentVariables: { date: "Aug 10" } });

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("ContentSid")).toBe("HXtest");
    expect(body.get("ContentVariables")).toBe(JSON.stringify({ date: "Aug 10" }));
    expect(body.get("Body")).toBeNull();
  });

  it("surfaces a Twilio API error instead of throwing", async () => {
    getEffectiveWhatsAppSender.mockResolvedValue(sender());
    getPlatformWhatsAppSettings.mockResolvedValue(enabledSettings());

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: "Invalid To number" }) })
    );

    const result = await sendWhatsAppMessage({ to: "bad-number", body: "hi" });
    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.reason).toBe("Invalid To number");
  });

  it("logs a structured failure event with no phone number or message body", async () => {
    getEffectiveWhatsAppSender.mockResolvedValue(sender());
    getPlatformWhatsAppSettings.mockResolvedValue(enabledSettings());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: "Invalid To number", code: 21211 }) })
    );

    await sendWhatsAppMessage({ to: "+15551234567", body: "a private family message" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged.event).toBe("whatsapp_send_failed");
    expect(logged.status).toBe(400);
    expect(logged.providerCode).toBe(21211);
    expect(logged.to).toBeUndefined();
    expect(logged.providerMessage).toBeUndefined();
    expect(JSON.stringify(logged)).not.toMatch(/5551234567|4567|Invalid To number/);
    expect(JSON.stringify(logged)).not.toMatch(/private family message/);
  });

  it("logs a structured failure event when the request itself throws", async () => {
    getEffectiveWhatsAppSender.mockResolvedValue(sender());
    getPlatformWhatsAppSettings.mockResolvedValue(enabledSettings());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unreachable")));

    const result = await sendWhatsAppMessage({ to: "+15551234567", body: "hi" });
    expect(result.sent).toBe(false);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged.event).toBe("whatsapp_send_failed");
    expect(logged.errorName).toBe("Error");
    expect(logged.error).toBeUndefined();
  });
});
