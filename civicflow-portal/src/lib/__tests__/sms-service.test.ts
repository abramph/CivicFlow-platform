import { beforeEach, describe, expect, it, vi } from "vitest";

const createSmsMessage = vi.fn();
const updateSmsMessage = vi.fn();
const findFirstOrgMember = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    smsMessage: {
      create: (...args: unknown[]) => createSmsMessage(...args),
      update: (...args: unknown[]) => updateSmsMessage(...args),
    },
    orgMember: {
      // sendMemberSms consults members through authorizeSmsSend, which uses a
      // tenant-scoped findFirst({ id, organizationId }) — never findUnique.
      findFirst: (...args: unknown[]) => findFirstOrgMember(...args),
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
const reserveSmsAllowance = vi.fn();
const releaseSmsAllowance = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/sms-entitlement", () => ({
  getSmsEntitlement: (...args: unknown[]) => getSmsEntitlement(...args),
  reserveSmsAllowance: (...args: unknown[]) => reserveSmsAllowance(...args),
  releaseSmsAllowance: (...args: unknown[]) => releaseSmsAllowance(...args),
}));

import { applySmsTemplateTokens, sendMemberSms } from "@/lib/sms-service";

// Period-bound reservation token as returned by reserveSmsAllowance — the
// release must be called with this exact token, never a bare org id.
const RESERVATION = {
  organizationId: "org-a",
  periodStart: new Date("2026-09-01T00:00:00.000Z"),
  periodEnd: new Date("2026-10-01T00:00:00.000Z"),
} as const;

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
    findFirstOrgMember.mockReset();
    isSmsConfigured.mockReset();
    sendSms.mockReset();
    getSmsEntitlement.mockReset();
    reserveSmsAllowance.mockReset().mockResolvedValue(RESERVATION);
    releaseSmsAllowance.mockClear();
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

  it("does not call Twilio when the member has never opted in to SMS", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });
    findFirstOrgMember.mockResolvedValueOnce({ smsOptIn: false, commsSmsEnabled: false, smsOptedOutAt: null });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("does not call Twilio when the member has SMS notifications toggled off, even though they've opted in", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });
    findFirstOrgMember.mockResolvedValueOnce({ smsOptIn: true, commsSmsEnabled: false, smsOptedOutAt: null });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("does not call Twilio when the member has a hard STOP opt-out, even if opted in and commsSmsEnabled is true", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });
    findFirstOrgMember.mockResolvedValueOnce({ smsOptIn: true, commsSmsEnabled: true, smsOptedOutAt: new Date() });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("required=true bypasses the commsSmsEnabled preference toggle but still requires real opt-in", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });
    findFirstOrgMember.mockResolvedValueOnce({ smsOptIn: true, commsSmsEnabled: false, smsOptedOutAt: null });
    createSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "QUEUED" });
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM1" });
    updateSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "SENT" });

    const result = await sendMemberSms(baseParams({ required: true }));

    expect(findFirstOrgMember).toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalled();
    expect(result.status).toBe("SENT");
    expect(reserveSmsAllowance).toHaveBeenCalledWith("org-a");
  });

  it("fails closed when the memberId no longer resolves within the organization (removed or transferred member)", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });
    findFirstOrgMember.mockResolvedValueOnce(null);
    createSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "FAILED", errorMessage: "Recipient is no longer a member of this organization." });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expect(sendSms).not.toHaveBeenCalled();
    expect(createSmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorMessage: "Recipient is no longer a member of this organization." }),
      })
    );
  });

  it("required=true does NOT bypass a hard STOP opt-out or missing consent", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });
    findFirstOrgMember.mockResolvedValueOnce({ smsOptIn: true, commsSmsEnabled: true, smsOptedOutAt: new Date() });

    const result = await sendMemberSms(baseParams({ required: true }));

    expect(result.status).toBe("FAILED");
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("rejects an invalid phone number before calling Twilio", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });

    const result = await sendMemberSms(baseParams({ phone: "not-a-phone", memberId: null }));

    expect(result.status).toBe("FAILED");
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("normalizes a typical US-formatted member phone number (e.g. from CSV import) before sending", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });
    findFirstOrgMember.mockResolvedValueOnce({ smsOptIn: true, commsSmsEnabled: true, smsOptedOutAt: null });
    createSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "QUEUED" });
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, to: "+12159174391" });
    updateSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "SENT" });

    const result = await sendMemberSms(baseParams({ phone: "215-917-4391" }));

    expect(result.status).toBe("SENT");
    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: "+12159174391" }));
    expect(createSmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: "+12159174391" }) })
    );
  });

  it("reserves exactly one allowance unit before Twilio and does not release it on success (no double count)", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 10, limit: 1000 });
    findFirstOrgMember.mockResolvedValueOnce({ smsOptIn: true, commsSmsEnabled: true, smsOptedOutAt: null });
    createSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "QUEUED" });
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM1" });
    updateSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "SENT" });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("SENT");
    expect(reserveSmsAllowance).toHaveBeenCalledTimes(1);
    expect(reserveSmsAllowance.mock.invocationCallOrder[0]).toBeLessThan(sendSms.mock.invocationCallOrder[0]);
    expect(releaseSmsAllowance).not.toHaveBeenCalled();
  });

  it("HARD STOP: when the atomic reservation is refused (allowance exhausted mid-race), Twilio is never called and the row fails with the allowance reason", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 1, limit: 1000 });
    findFirstOrgMember.mockResolvedValueOnce({ smsOptIn: true, commsSmsEnabled: true, smsOptedOutAt: null });
    createSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "QUEUED" });
    reserveSmsAllowance.mockResolvedValueOnce(null);
    updateSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "FAILED" });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expect(sendSms).not.toHaveBeenCalled();
    expect(updateSmsMessage).toHaveBeenCalledWith({
      where: { id: "sms-1" },
      data: { status: "FAILED", errorMessage: "Your organization has used its full monthly SMS allowance." },
    });
  });

  it("CONSENT BYPASS regression: a valid phone with memberId: null never reaches Twilio and reserves nothing", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });
    createSmsMessage.mockResolvedValueOnce({
      id: "sms-1",
      status: "FAILED",
      errorMessage: "Recipient consent cannot be verified for this message.",
    });

    const result = await sendMemberSms(baseParams({ memberId: null }));

    expect(result.status).toBe("FAILED");
    expect(sendSms).not.toHaveBeenCalled();
    expect(reserveSmsAllowance).not.toHaveBeenCalled();
    expect(findFirstOrgMember).not.toHaveBeenCalled();
    expect(createSmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorMessage: "Recipient consent cannot be verified for this message." }),
      })
    );
  });

  it("marks FAILED and releases the reserved unit when Twilio itself errors", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });
    findFirstOrgMember.mockResolvedValueOnce({ smsOptIn: true, commsSmsEnabled: true, smsOptedOutAt: null });
    createSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "QUEUED" });
    sendSms.mockResolvedValueOnce({ sent: false, skipped: false, to: "+15551234567", reason: "Twilio request failed (500)" });
    updateSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "FAILED", errorMessage: "Twilio request failed (500)" });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expect(reserveSmsAllowance).toHaveBeenCalledTimes(1);
    expect(releaseSmsAllowance).toHaveBeenCalledWith(RESERVATION);
  });

  it("appends the opt-out compliance suffix to the message body", async () => {
    isSmsConfigured.mockReturnValueOnce(true);
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 1000 });
    findFirstOrgMember.mockResolvedValueOnce({ smsOptIn: true, commsSmsEnabled: true, smsOptedOutAt: null });
    createSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "QUEUED" });
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567" });
    updateSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "SENT" });

    await sendMemberSms(baseParams({ body: "Hello there" }));

    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Reply STOP to opt out.") }));
  });
});

describe("applySmsTemplateTokens", () => {
  it("substitutes organizationName and link tokens", () => {
    const result = applySmsTemplateTokens("Reminder: Your {organizationName} dues are due. Open Unestra: {link}", {
      organizationName: "ThrivePath Foundation",
      link: "https://app.getunestra.com/report-payment",
    });
    expect(result).toBe("Reminder: Your ThrivePath Foundation dues are due. Open Unestra: https://app.getunestra.com/report-payment");
  });

  it("substitutes an empty string when no link is provided", () => {
    const result = applySmsTemplateTokens("See {link} for details", { organizationName: "Org", link: null });
    expect(result).toBe("See  for details");
  });
});
