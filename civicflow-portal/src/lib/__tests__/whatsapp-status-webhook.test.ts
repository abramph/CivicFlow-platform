import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const updateManyWhatsAppMessage = vi.fn().mockResolvedValue({ count: 1 });
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
    whatsAppMessage: {
      updateMany: (...args: unknown[]) => updateManyWhatsAppMessage(...args),
    },
    platformSmsSettings: {
      findFirst: (...args: unknown[]) => findFirstPlatformSmsSettings(...args),
    },
  },
}));

import { POST } from "@/app/api/webhooks/twilio/whatsapp/status/route";

const AUTH_TOKEN = "test-auth-token";
const URL = "https://civicflow-portal-iule6.ondigitalocean.app/api/webhooks/twilio/whatsapp/status";

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

describe("Twilio WhatsApp delivery-status webhook", () => {
  const originalApiKey = process.env.SMS_API_KEY;
  const originalAccountSid = process.env.TWILIO_ACCOUNT_SID;

  beforeEach(() => {
    updateManyWhatsAppMessage.mockClear();
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
    expect(updateManyWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("updates the matching message to DELIVERED, sets deliveredAt, and records the real Twilio cost", async () => {
    const request = makeRequest({ MessageSid: "SM1", MessageStatus: "delivered", Price: "-0.0079", PriceUnit: "USD" });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(updateManyWhatsAppMessage).toHaveBeenCalledWith({
      where: { providerMessageId: "SM1" },
      data: { status: "DELIVERED", actualCostCents: 1, deliveredAt: expect.any(Date) },
    });
  });

  it("maps read to READ and sets readAt — a terminal state SMS never reports", async () => {
    const request = makeRequest({ MessageSid: "SM2", MessageStatus: "read" });
    await POST(request);
    expect(updateManyWhatsAppMessage).toHaveBeenCalledWith({
      where: { providerMessageId: "SM2" },
      data: { status: "READ", readAt: expect.any(Date) },
    });
  });

  it("maps undelivered to UNDELIVERED (distinct from FAILED) with failedAt and error details", async () => {
    const request = makeRequest({
      MessageSid: "SM3",
      MessageStatus: "undelivered",
      ErrorCode: "63016",
      ErrorMessage: "Recipient has not opted in",
    });
    await POST(request);
    expect(updateManyWhatsAppMessage).toHaveBeenCalledWith({
      where: { providerMessageId: "SM3" },
      data: {
        status: "UNDELIVERED",
        failedAt: expect.any(Date),
        errorCode: "63016",
        errorMessage: "Recipient has not opted in",
      },
    });
  });

  it("maps failed to FAILED with failedAt", async () => {
    const request = makeRequest({ MessageSid: "SM4", MessageStatus: "failed", ErrorCode: "63003" });
    await POST(request);
    expect(updateManyWhatsAppMessage).toHaveBeenCalledWith({
      where: { providerMessageId: "SM4" },
      data: { status: "FAILED", failedAt: expect.any(Date), errorCode: "63003" },
    });
  });

  it("maps queued/sending/sent statuses without terminal timestamps", async () => {
    await POST(makeRequest({ MessageSid: "SM5", MessageStatus: "sending" }));
    expect(updateManyWhatsAppMessage).toHaveBeenCalledWith({ where: { providerMessageId: "SM5" }, data: { status: "SENDING" } });
  });

  it("ignores an unrecognized status without erroring", async () => {
    const response = await POST(makeRequest({ MessageSid: "SM6", MessageStatus: "receiving" }));
    expect(response.status).toBe(200);
    expect(updateManyWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("does nothing when MessageSid is missing", async () => {
    const response = await POST(makeRequest({ MessageStatus: "delivered" }));
    expect(response.status).toBe(200);
    expect(updateManyWhatsAppMessage).not.toHaveBeenCalled();
  });
});
