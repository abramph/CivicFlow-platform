import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const updateManyOrgMember = vi.fn().mockResolvedValue({ count: 1 });
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: {
      updateMany: (...args: unknown[]) => updateManyOrgMember(...args),
    },
  },
}));

import { POST } from "@/app/api/webhooks/twilio/inbound/route";

const AUTH_TOKEN = "test-auth-token";
const URL = "https://civicflow-portal-iule6.ondigitalocean.app/api/webhooks/twilio/inbound";

function signParams(url: string, params: Record<string, string>, authToken: string): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

function makeRequest(params: Record<string, string>, options: { signature?: string; authToken?: string } = {}) {
  const body = new URLSearchParams(params).toString();
  const signature = options.signature ?? signParams(URL, params, options.authToken ?? AUTH_TOKEN);
  return new Request(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": signature,
    },
    body,
  });
}

describe("Twilio inbound webhook", () => {
  const originalApiKey = process.env.SMS_API_KEY;

  beforeEach(() => {
    updateManyOrgMember.mockClear();
    process.env.SMS_API_KEY = AUTH_TOKEN;
  });

  afterEach(() => {
    process.env.SMS_API_KEY = originalApiKey;
  });

  it("rejects a request with no signature header", async () => {
    const request = new Request(URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ From: "+15551234567", Body: "STOP" }).toString(),
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(updateManyOrgMember).not.toHaveBeenCalled();
  });

  it("rejects a request with an invalid signature", async () => {
    const request = makeRequest({ From: "+15551234567", Body: "STOP" }, { signature: "bogus-signature" });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(updateManyOrgMember).not.toHaveBeenCalled();
  });

  it("rejects a request when SMS_API_KEY is not configured", async () => {
    delete process.env.SMS_API_KEY;
    const request = makeRequest({ From: "+15551234567", Body: "STOP" });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(updateManyOrgMember).not.toHaveBeenCalled();
  });

  it("opts a member out on a verified STOP keyword", async () => {
    const request = makeRequest({ From: "+15551234567", Body: "STOP" });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(updateManyOrgMember).toHaveBeenCalledWith({
      where: { phone: "+15551234567" },
      data: { commsSmsEnabled: false, smsOptedOutAt: expect.any(Date) },
    });
  });

  it("treats other STOP-family keywords the same way", async () => {
    const request = makeRequest({ From: "+15551234567", Body: "unsubscribe" });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(updateManyOrgMember).toHaveBeenCalledWith({
      where: { phone: "+15551234567" },
      data: { commsSmsEnabled: false, smsOptedOutAt: expect.any(Date) },
    });
  });

  it("opts a member back in on a verified START keyword, clearing smsOptedOutAt", async () => {
    const request = makeRequest({ From: "+15551234567", Body: "START" });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(updateManyOrgMember).toHaveBeenCalledWith({
      where: { phone: "+15551234567" },
      data: { commsSmsEnabled: true, smsOptedOutAt: null },
    });
  });

  it("does nothing for a message body that isn't a STOP/START keyword", async () => {
    const request = makeRequest({ From: "+15551234567", Body: "Thanks!" });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(updateManyOrgMember).not.toHaveBeenCalled();
  });
});
