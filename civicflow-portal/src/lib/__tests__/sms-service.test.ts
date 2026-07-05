import { beforeEach, describe, expect, it, vi } from "vitest";

const createSmsMessage = vi.fn();
const updateSmsMessage = vi.fn();
const findUniqueOrgMember = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    smsMessage: {
      create: (...args: unknown[]) => createSmsMessage(...args),
      update: (...args: unknown[]) => updateSmsMessage(...args),
    },
    orgMember: {
      findUnique: (...args: unknown[]) => findUniqueOrgMember(...args),
    },
  },
}));

const isSmsConfigured = vi.fn();
const sendSms = vi.fn();
vi.mock("@/lib/sms", () => ({
  isSmsConfigured: () => isSmsConfigured(),
  sendSms: (...args: unknown[]) => sendSms(...args),
}));

const getSmsEntitlement = vi.fn();
const recordSmsUsage = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/sms-entitlement", () => ({
  getSmsEntitlement: (...args: unknown[]) => getSmsEntitlement(...args),
  recordSmsUsage: (...args: unknown[]) => recordSmsUsage(...args),
}));

import { applySmsTemplateTokens, sendMemberSms } from "@/lib/sms-service";

function baseParams(overrides: Partial<Parameters<typeof sendMemberSms>[0]> = {}) {
  return {
    organizationId: "org-a",
    memberId: "member-1",
    phone: "+15551234567",
    body: "Test message",
    ...overrides,
  };
}

describe("sendMemberSms", () => {
  beforeEach(() => {
    createSmsMessage.mockReset();
    updateSmsMessage.mockReset();
    findUniqueOrgMember.mockReset();
    isSmsConfigured.mockReset();
    sendSms.mockReset();
    getSmsEntitlement.mockReset();
    recordSmsUsage.mockClear();
    createSmsMessage.mockResolvedValue({ id: "sms-1", status: "FAILED" });
  });

  it("fails gracefully with a clear message when SMS is not configured, never calling Twilio", async () => {
    isSmsConfigured.mockReturnValueOnce(false);
    createSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "FAILED", errorMessage: "SMS delivery is not configured." });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expect(createSmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", errorMessage: "SMS delivery is not configured." }) })
    );
    expect(sendSms).not.toHaveBeenCalled();
    expect(getSmsEntitlement).not.toHaveBeenCalled();
  });

  it("fails gracefully when the organization has no SMS entitlement, never calling Twilio", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: false, reason: "Your organization does not have the SMS add-on enabled.", remaining: 0, limit: 0 });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("does not call Twilio when the member has opted out", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });
    findUniqueOrgMember.mockResolvedValueOnce({ commsSmsEnabled: false, smsOptedOutAt: null });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("does not call Twilio when the member has a hard STOP opt-out, even if commsSmsEnabled is true", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });
    findUniqueOrgMember.mockResolvedValueOnce({ commsSmsEnabled: true, smsOptedOutAt: new Date() });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("bypasses the opt-out check when required=true (legally required notices)", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });
    createSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "QUEUED" });
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM1" });
    updateSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "SENT" });

    const result = await sendMemberSms(baseParams({ required: true }));

    expect(findUniqueOrgMember).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalled();
    expect(result.status).toBe("SENT");
    expect(recordSmsUsage).toHaveBeenCalledWith("org-a");
  });

  it("rejects an invalid phone number before calling Twilio", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });

    const result = await sendMemberSms(baseParams({ phone: "not-a-phone", memberId: null }));

    expect(result.status).toBe("FAILED");
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("records usage and marks SENT on a successful Twilio send, and allows overage (soft cap)", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    // remaining is negative — already over the limit — but still allowed (soft cap).
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: -10, limit: 1000 });
    findUniqueOrgMember.mockResolvedValueOnce({ commsSmsEnabled: true, smsOptedOutAt: null });
    createSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "QUEUED" });
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM1" });
    updateSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "SENT" });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("SENT");
    expect(recordSmsUsage).toHaveBeenCalledWith("org-a");
  });

  it("marks FAILED and does not record usage when Twilio itself errors", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });
    findUniqueOrgMember.mockResolvedValueOnce({ commsSmsEnabled: true, smsOptedOutAt: null });
    createSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "QUEUED" });
    sendSms.mockResolvedValueOnce({ sent: false, skipped: false, to: "+15551234567", reason: "Twilio request failed (500)" });
    updateSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "FAILED", errorMessage: "Twilio request failed (500)" });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expect(recordSmsUsage).not.toHaveBeenCalled();
  });

  it("appends the opt-out compliance suffix to the message body", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });
    findUniqueOrgMember.mockResolvedValueOnce({ commsSmsEnabled: true, smsOptedOutAt: null });
    createSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "QUEUED" });
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567" });
    updateSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "SENT" });

    await sendMemberSms(baseParams({ body: "Hello there" }));

    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Reply STOP to opt out.") }));
  });
});

describe("applySmsTemplateTokens", () => {
  it("substitutes organizationName and link tokens", () => {
    const result = applySmsTemplateTokens("Reminder: Your {organizationName} dues are due. Open CivicFlow: {link}", {
      organizationName: "ThrivePath Foundation",
      link: "https://app.civicflowapp.com/report-payment",
    });
    expect(result).toBe("Reminder: Your ThrivePath Foundation dues are due. Open CivicFlow: https://app.civicflowapp.com/report-payment");
  });

  it("substitutes an empty string when no link is provided", () => {
    const result = applySmsTemplateTokens("See {link} for details", { organizationName: "Org", link: null });
    expect(result).toBe("See  for details");
  });
});
