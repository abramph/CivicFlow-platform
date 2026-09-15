import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
vi.mock("@/lib/mail", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));

const sendOrganizationTokensPush = vi.fn();
vi.mock("@/lib/notifications/send", () => ({
  sendOrganizationTokensPush: (...args: unknown[]) => sendOrganizationTokensPush(...args),
}));

const sendMemberSms = vi.fn();
vi.mock("@/lib/sms-service", () => ({ sendMemberSms: (...args: unknown[]) => sendMemberSms(...args) }));

const sendMemberWhatsApp = vi.fn();
vi.mock("@/lib/whatsapp/whatsapp-service", () => ({
  sendMemberWhatsApp: (...args: unknown[]) => sendMemberWhatsApp(...args),
}));

import { EmailChannel, PushChannel, SmsChannel, WhatsAppChannel } from "@/lib/communications/channel";

describe("EmailChannel", () => {
  beforeEach(() => sendEmail.mockReset());

  it("delegates to sendEmail unmodified and normalizes a successful send to SENT", async () => {
    sendEmail.mockResolvedValueOnce({ sent: true, skipped: false });
    const params = { to: "a@example.com", subject: "Hi", text: "Body" };
    const result = await EmailChannel.send(params);
    expect(sendEmail).toHaveBeenCalledWith(params);
    expect(result).toEqual({ status: "SENT", errorMessage: null });
  });

  it("normalizes a skipped send to SKIPPED with the reason", async () => {
    sendEmail.mockResolvedValueOnce({ sent: false, skipped: true, reason: "ENABLE_EMAIL_SEND is not enabled" });
    const result = await EmailChannel.send({ to: "a@example.com", subject: "Hi", text: "Body" });
    expect(result).toEqual({ status: "SKIPPED", errorMessage: "ENABLE_EMAIL_SEND is not enabled" });
  });
});

describe("SmsChannel", () => {
  beforeEach(() => sendMemberSms.mockReset());

  it("delegates to sendMemberSms unmodified and normalizes SENT", async () => {
    sendMemberSms.mockResolvedValueOnce({ status: "SENT", errorMessage: null, providerMessageId: "SM1" });
    // memberId is a REQUIRED field of the org-message contract (consent is
    // unverifiable without a roster member) — the compiler enforces it here.
    const params = { organizationId: "org-a", memberId: "member-1", phone: "+15551234567", body: "Hi" };
    const result = await SmsChannel.send(params);
    expect(sendMemberSms).toHaveBeenCalledWith(params);
    expect(result).toEqual({ status: "SENT", errorMessage: null, providerMessageId: "SM1" });
  });

  it("normalizes a FAILED SmsMessage to FAILED", async () => {
    sendMemberSms.mockResolvedValueOnce({ status: "FAILED", errorMessage: "Member opted out of SMS.", providerMessageId: null });
    const result = await SmsChannel.send({ organizationId: "org-a", memberId: "member-1", phone: "+15551234567", body: "Hi" });
    expect(result.status).toBe("FAILED");
  });
});

describe("WhatsAppChannel", () => {
  beforeEach(() => sendMemberWhatsApp.mockReset());

  it("delegates to sendMemberWhatsApp unmodified and normalizes SENT", async () => {
    sendMemberWhatsApp.mockResolvedValueOnce({ status: "SENT", errorMessage: null, providerMessageId: "SM2" });
    const params = { organizationId: "org-a", phone: "+15551234567", body: "Hi" };
    const result = await WhatsAppChannel.send(params);
    expect(sendMemberWhatsApp).toHaveBeenCalledWith(params);
    expect(result).toEqual({ status: "SENT", errorMessage: null, providerMessageId: "SM2" });
  });

  it("normalizes a FAILED WhatsAppMessage to FAILED", async () => {
    sendMemberWhatsApp.mockResolvedValueOnce({ status: "FAILED", errorMessage: "Member has not opted in to WhatsApp.", providerMessageId: null });
    const result = await WhatsAppChannel.send({ organizationId: "org-a", phone: "+15551234567", body: "Hi" });
    expect(result.status).toBe("FAILED");
  });
});

describe("PushChannel", () => {
  beforeEach(() => sendOrganizationTokensPush.mockReset());

  it("skips without calling the sender when there are no device tokens", async () => {
    const result = await PushChannel.send({ organizationId: "org-a", tokens: [], category: "ANNOUNCEMENT", body: "Body" });
    expect(sendOrganizationTokensPush).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "SKIPPED", errorMessage: "No registered devices" });
  });

  it("routes through the canonical organization sender (org-branded, never a caller title)", async () => {
    sendOrganizationTokensPush.mockResolvedValueOnce({ sent: 1, failed: 0 });
    const result = await PushChannel.send({
      organizationId: "org-a",
      tokens: ["ExponentPushToken[a]"],
      category: "ANNOUNCEMENT",
      body: "Body",
      deepLink: "/announcements/c1",
    });
    expect(sendOrganizationTokensPush).toHaveBeenCalledWith({
      organizationId: "org-a",
      tokens: ["ExponentPushToken[a]"],
      category: "ANNOUNCEMENT",
      body: "Body",
      deepLink: "/announcements/c1",
      data: undefined,
    });
    expect(result).toEqual({ status: "SENT" });
  });

  it("normalizes zero successful deliveries (all failed) to FAILED", async () => {
    sendOrganizationTokensPush.mockResolvedValueOnce({ sent: 0, failed: 1 });
    const result = await PushChannel.send({ organizationId: "org-a", tokens: ["ExponentPushToken[a]"], category: "ANNOUNCEMENT", body: "Body" });
    expect(result).toEqual({ status: "FAILED", errorMessage: "Delivery failed" });
  });
});
