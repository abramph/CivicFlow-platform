import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const updateManyOrgMember = vi.fn().mockResolvedValue({ count: 1 });
const queryRawOrgMember = vi.fn().mockResolvedValue([{ id: "member-1", organizationId: "org-1" }]);
// No credentials configured in the database — resolves via the env-var
// fallback in getEffectiveTwilioCredentials(), same as before this route
// started going through that resolver.
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
    orgMember: {
      updateMany: (...args: unknown[]) => updateManyOrgMember(...args),
    },
    $queryRaw: (...args: unknown[]) => queryRawOrgMember(...args),
    platformSmsSettings: {
      findFirst: (...args: unknown[]) => findFirstPlatformSmsSettings(...args),
    },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

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
  const originalAccountSid = process.env.TWILIO_ACCOUNT_SID;

  beforeEach(() => {
    updateManyOrgMember.mockClear();
    queryRawOrgMember.mockClear();
    queryRawOrgMember.mockResolvedValue([{ id: "member-1", organizationId: "org-1" }]);
    findFirstPlatformSmsSettings.mockClear();
    createAuditEvent.mockClear();
    process.env.SMS_API_KEY = AUTH_TOKEN;
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
  });

  afterEach(() => {
    process.env.SMS_API_KEY = originalApiKey;
    process.env.TWILIO_ACCOUNT_SID = originalAccountSid;
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

  it("opts a member out on a verified STOP keyword, matching by id from the phone lookup", async () => {
    queryRawOrgMember.mockResolvedValueOnce([
      { id: "member-1", organizationId: "org-1" },
      { id: "member-2", organizationId: "org-2" },
    ]);
    const request = makeRequest({ From: "+15551234567", Body: "STOP" });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(updateManyOrgMember).toHaveBeenCalledWith({
      where: { id: { in: ["member-1", "member-2"] } },
      data: { commsSmsEnabled: false, smsOptedOutAt: expect.any(Date), smsOptIn: false, smsOptOutDate: expect.any(Date) },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", action: "sms_consent.opt_out", entityId: "member-1" })
    );
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-2", action: "sms_consent.opt_out", entityId: "member-2" })
    );
  });

  it("looks up members by digits-only phone (full and last-10) so mixed-format stored numbers still match", async () => {
    const request = makeRequest({ From: "+15551234567", Body: "STOP" });
    await POST(request);
    const callArgs = queryRawOrgMember.mock.calls[0];
    expect(callArgs).toContain("15551234567");
    expect(callArgs).toContain("5551234567");
  });

  it("treats other STOP-family keywords the same way", async () => {
    const request = makeRequest({ From: "+15551234567", Body: "unsubscribe" });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(updateManyOrgMember).toHaveBeenCalledWith({
      where: { id: { in: ["member-1"] } },
      data: { commsSmsEnabled: false, smsOptedOutAt: expect.any(Date), smsOptIn: false, smsOptOutDate: expect.any(Date) },
    });
  });

  it("opts a member back in on a verified START keyword, clearing smsOptedOutAt and restoring smsOptIn", async () => {
    const request = makeRequest({ From: "+15551234567", Body: "START" });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(updateManyOrgMember).toHaveBeenCalledWith({
      where: { id: { in: ["member-1"] } },
      data: { commsSmsEnabled: true, smsOptedOutAt: null, smsOptIn: true, smsOptOutDate: null },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", action: "sms_consent.opt_in", entityId: "member-1" })
    );
  });

  it("replies with support info on a verified HELP keyword, without touching consent state", async () => {
    const request = makeRequest({ From: "+15551234567", Body: "HELP" });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("<Message>");
    expect(text).toContain("support@getunestra.com");
    expect(queryRawOrgMember).not.toHaveBeenCalled();
    expect(updateManyOrgMember).not.toHaveBeenCalled();
  });

  it("does nothing when no member matches the phone number", async () => {
    queryRawOrgMember.mockResolvedValueOnce([]);
    const request = makeRequest({ From: "+15551234567", Body: "STOP" });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(updateManyOrgMember).not.toHaveBeenCalled();
  });

  it("does nothing for a message body that isn't a STOP/START keyword", async () => {
    const request = makeRequest({ From: "+15551234567", Body: "Thanks!" });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(queryRawOrgMember).not.toHaveBeenCalled();
    expect(updateManyOrgMember).not.toHaveBeenCalled();
  });
});
