import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSmsConfigured, sendSms } from "@/lib/sms";

const originalEnv = { ...process.env };

describe("isSmsConfigured / sendSms", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.SMS_PROVIDER;
    delete process.env.SMS_API_KEY;
    delete process.env.SMS_FROM_NUMBER;
    delete process.env.TWILIO_ACCOUNT_SID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reports unconfigured and skips sending when env vars are missing", async () => {
    const result = await sendSms({ to: "+15551234567", body: "hello" });
    expect(isSmsConfigured()).toBe(false);
    expect(result).toEqual({ sent: false, skipped: true, reason: "SMS provider is not configured", to: "+15551234567" });
  });

  it("skips with a clear reason for an unsupported provider", async () => {
    process.env.SMS_PROVIDER = "carrier-pigeon";
    process.env.SMS_API_KEY = "key";
    process.env.SMS_FROM_NUMBER = "+15550000000";

    const result = await sendSms({ to: "+15551234567", body: "hello" });
    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/Unsupported SMS_PROVIDER/);
  });

  it("sends via Twilio's REST API when configured", async () => {
    process.env.SMS_PROVIDER = "twilio";
    process.env.SMS_API_KEY = "auth-token";
    process.env.SMS_FROM_NUMBER = "+15550000000";
    process.env.TWILIO_ACCOUNT_SID = "ACxxxx";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: "SM123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendSms({ to: "+15551234567", body: "your code is 123456" });

    expect(result).toEqual({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM123" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.twilio.com/2010-04-01/Accounts/ACxxxx/Messages.json",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("surfaces a Twilio API error instead of throwing", async () => {
    process.env.SMS_PROVIDER = "twilio";
    process.env.SMS_API_KEY = "auth-token";
    process.env.SMS_FROM_NUMBER = "+15550000000";
    process.env.TWILIO_ACCOUNT_SID = "ACxxxx";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: "Invalid To number" }) })
    );

    const result = await sendSms({ to: "bad-number", body: "hi" });
    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.reason).toBe("Invalid To number");
  });
});
