import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const updateManySmsMessage = vi.fn().mockResolvedValue({ count: 1 });
const findFirstPlatformSmsSettings = vi.fn().mockResolvedValue({
  id: "settings-1",
  accountSidEncrypted: null,
  authTokenEncrypted: null,
  apiKeyEncrypted: null,
  apiSecretEncrypted: null,
  messagingServiceSidEncrypted: null,
  tollFreeNumberEncrypted: null,
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    smsMessage: {
      updateMany: (...args: unknown[]) => updateManySmsMessage(...args),
    },
    platformSmsSettings: {
      findFirst: (...args: unknown[]) => findFirstPlatformSmsSettings(...args),
    },
  },
}));

import { POST } from "@/app/api/webhooks/twilio/status/route";

const AUTH_TOKEN = "test-auth-token";
const URL = "https://civicflow-portal-iule6.ondigitalocean.app/api/webhooks/twilio/status";

function signParams(url: string, params: Record<string, string>, authToken: string): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

function makeRequest(params: Record<string, string>) {
  const body = new URLSearchParams(params).toString();
  const signature = signParams(URL, params, AUTH_TOKEN);
  return new Request(URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature },
    body,
  });
}

describe("Twilio delivery-status webhook", () => {
  const originalApiKey = process.env.SMS_API_KEY;
  const originalAccountSid = process.env.TWILIO_ACCOUNT_SID;

  beforeEach(() => {
    updateManySmsMessage.mockClear();
    findFirstPlatformSmsSettings.mockClear();
    process.env.SMS_API_KEY = AUTH_TOKEN;
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
  });

  afterEach(() => {
    process.env.SMS_API_KEY = originalApiKey;
    process.env.TWILIO_ACCOUNT_SID = originalAccountSid;
  });

  it("rejects a request with an invalid signature", async () => {
    const request = new Request(URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "bogus" },
      body: new URLSearchParams({ MessageSid: "SM1", MessageStatus: "delivered" }).toString(),
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(updateManySmsMessage).not.toHaveBeenCalled();
  });

  it("updates the matching message to DELIVERED and records the real Twilio cost", async () => {
    const request = makeRequest({ MessageSid: "SM1", MessageStatus: "delivered", Price: "-0.0079", PriceUnit: "USD" });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(updateManySmsMessage).toHaveBeenCalledWith({
      where: { providerMessageId: "SM1" },
      data: { status: "DELIVERED", actualCostCents: 1 },
    });
  });

  it("maps undelivered/failed to FAILED and records the error message", async () => {
    const request = makeRequest({
      MessageSid: "SM2",
      MessageStatus: "undelivered",
      ErrorMessage: "Landline or unreachable carrier",
    });
    await POST(request);
    expect(updateManySmsMessage).toHaveBeenCalledWith({
      where: { providerMessageId: "SM2" },
      data: { status: "FAILED", errorMessage: "Landline or unreachable carrier" },
    });
  });

  it("maps queued/sending/sent statuses", async () => {
    await POST(makeRequest({ MessageSid: "SM3", MessageStatus: "sending" }));
    expect(updateManySmsMessage).toHaveBeenCalledWith({ where: { providerMessageId: "SM3" }, data: { status: "SENDING" } });
  });

  it("ignores an unrecognized status without erroring", async () => {
    const response = await POST(makeRequest({ MessageSid: "SM4", MessageStatus: "receiving" }));
    expect(response.status).toBe(200);
    expect(updateManySmsMessage).not.toHaveBeenCalled();
  });

  it("does nothing when MessageSid is missing", async () => {
    const response = await POST(makeRequest({ MessageStatus: "delivered" }));
    expect(response.status).toBe(200);
    expect(updateManySmsMessage).not.toHaveBeenCalled();
  });
});
