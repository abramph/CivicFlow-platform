import { beforeEach, describe, expect, it, vi } from "vitest";

const findManySmsMessage = vi.fn();
const updateSmsMessage = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    smsMessage: {
      findMany: (...args: unknown[]) => findManySmsMessage(...args),
      update: (...args: unknown[]) => updateSmsMessage(...args),
    },
  },
}));

const sendSms = vi.fn();
vi.mock("@/lib/sms", () => ({ sendSms: (...args: unknown[]) => sendSms(...args) }));

const resolveOrganizationAccess = vi.fn();
vi.mock("@/lib/subscription-gate", () => ({
  resolveOrganizationAccess: (...args: unknown[]) => resolveOrganizationAccess(...args),
}));

const authorizeSmsSend = vi.fn();
vi.mock("@/lib/sms-send-authorization", () => ({
  authorizeSmsSend: (...args: unknown[]) => authorizeSmsSend(...args),
}));

const ALLOWED = { allowed: true, reason: null, trialEndsAt: null, subscriptionStatus: null, billingExempt: false } as const;
const AUTHORIZED = { allowed: true, normalizedPhone: "+15551234567" } as const;

const MESSAGE = { id: "msg-1", organizationId: "org-a", memberId: "member-1", phone: "+15551234567", body: "hi" };

import { attemptSmsMessageResend, processRetryableSmsMessages } from "@/lib/sms-queue";

describe("attemptSmsMessageResend", () => {
  beforeEach(() => {
    updateSmsMessage.mockReset();
    sendSms.mockReset();
    resolveOrganizationAccess.mockReset().mockResolvedValue(ALLOWED);
    authorizeSmsSend.mockReset().mockResolvedValue(AUTHORIZED);
  });

  it("marks SENT on a successful resend", async () => {
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM1" });
    updateSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "SENT" });

    await attemptSmsMessageResend(MESSAGE);

    expect(updateSmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { status: "SENT", sentAt: expect.any(Date), providerMessageId: "SM1", errorMessage: null },
    });
  });

  it("marks FAILED with the failure reason on an unsuccessful resend", async () => {
    sendSms.mockResolvedValueOnce({ sent: false, skipped: false, to: "+15551234567", reason: "carrier rejected" });
    updateSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "FAILED" });

    await attemptSmsMessageResend(MESSAGE);

    expect(updateSmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { status: "FAILED", errorMessage: "carrier rejected" },
    });
  });

  it("LAUNCH-BLOCKER: marks FAILED without calling sendSms when the organization is billing-inactive — applies to the manual Retry button too, since it shares this function", async () => {
    resolveOrganizationAccess.mockResolvedValueOnce({ allowed: false, reason: "TRIAL_EXPIRED", trialEndsAt: null, subscriptionStatus: null, billingExempt: false });
    updateSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "FAILED" });

    await attemptSmsMessageResend(MESSAGE);

    expect(sendSms).not.toHaveBeenCalled();
    expect(authorizeSmsSend).not.toHaveBeenCalled();
    expect(updateSmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { status: "FAILED", errorMessage: "Organization subscription is not active." },
    });
  });

  it("re-runs the full canonical authorization at retry time, member-required and with no preference bypass", async () => {
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM1" });
    updateSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "SENT" });

    await attemptSmsMessageResend(MESSAGE);

    expect(authorizeSmsSend).toHaveBeenCalledWith({
      organizationId: "org-a",
      memberId: "member-1",
      phone: "+15551234567",
      required: false,
      requireMember: true,
    });
  });

  it("COMPLIANCE: a member who texted STOP after the original failure cannot be reached by a retry — no Twilio call", async () => {
    authorizeSmsSend.mockResolvedValueOnce({ allowed: false, reason: "Member opted out of SMS." });
    updateSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "FAILED" });

    await attemptSmsMessageResend(MESSAGE);

    expect(sendSms).not.toHaveBeenCalled();
    expect(updateSmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { status: "FAILED", errorMessage: "Member opted out of SMS." },
    });
  });

  it("COMPLIANCE: an org whose SMS add-on was deactivated after queueing is blocked at retry time — no Twilio call", async () => {
    authorizeSmsSend.mockResolvedValueOnce({
      allowed: false,
      reason: "Your organization does not have the SMS add-on enabled.",
    });
    updateSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "FAILED" });

    await attemptSmsMessageResend(MESSAGE);

    expect(sendSms).not.toHaveBeenCalled();
    expect(updateSmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { status: "FAILED", errorMessage: "Your organization does not have the SMS add-on enabled." },
    });
  });

  it("COMPLIANCE: a queued row whose member was removed (memberId nulled) is blocked — consent is unverifiable", async () => {
    authorizeSmsSend.mockResolvedValueOnce({ allowed: false, reason: "Recipient consent cannot be verified for this message." });
    updateSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "FAILED" });

    await attemptSmsMessageResend({ ...MESSAGE, memberId: null });

    expect(authorizeSmsSend).toHaveBeenCalledWith(expect.objectContaining({ memberId: null, requireMember: true }));
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("sends to the freshly normalized phone returned by the authorization, not the raw stored value", async () => {
    authorizeSmsSend.mockResolvedValueOnce({ allowed: true, normalizedPhone: "+12159174391" });
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, to: "+12159174391" });
    updateSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "SENT" });

    await attemptSmsMessageResend({ ...MESSAGE, phone: "215-917-4391" });

    expect(sendSms).toHaveBeenCalledWith({ to: "+12159174391", body: "hi" });
  });
});

describe("processRetryableSmsMessages", () => {
  beforeEach(() => {
    findManySmsMessage.mockReset();
    updateSmsMessage.mockReset();
    sendSms.mockReset();
    resolveOrganizationAccess.mockReset().mockResolvedValue(ALLOWED);
    authorizeSmsSend.mockReset().mockResolvedValue(AUTHORIZED);
  });

  it("processes every due RETRYING message", async () => {
    findManySmsMessage.mockResolvedValueOnce([
      { id: "msg-1", organizationId: "org-a", memberId: "m-1", phone: "+15551234567", body: "a" },
      { id: "msg-2", organizationId: "org-b", memberId: "m-2", phone: "+15559876543", body: "b" },
    ]);
    sendSms.mockResolvedValue({ sent: true, skipped: false, to: "x", providerMessageId: "SM1" });
    updateSmsMessage.mockResolvedValue({});

    const result = await processRetryableSmsMessages();

    expect(findManySmsMessage).toHaveBeenCalledWith({
      where: { status: "RETRYING", nextRetryAt: { lte: expect.any(Date) } },
      take: 50,
    });
    expect(result.processed).toBe(2);
    expect(sendSms).toHaveBeenCalledTimes(2);
  });

  it("COMPLIANCE: the cron sweep cannot resend to a STOPped recipient — the row fails, Twilio is never called", async () => {
    findManySmsMessage.mockResolvedValueOnce([
      { id: "msg-1", organizationId: "org-a", memberId: "m-1", phone: "+15551234567", body: "a" },
    ]);
    authorizeSmsSend.mockResolvedValueOnce({ allowed: false, reason: "Member opted out of SMS." });
    updateSmsMessage.mockResolvedValue({});

    const result = await processRetryableSmsMessages();

    expect(result.processed).toBe(1);
    expect(sendSms).not.toHaveBeenCalled();
    expect(updateSmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { status: "FAILED", errorMessage: "Member opted out of SMS." },
    });
  });

  it("returns processed: 0 when nothing is due", async () => {
    findManySmsMessage.mockResolvedValueOnce([]);
    const result = await processRetryableSmsMessages();
    expect(result.processed).toBe(0);
    expect(sendSms).not.toHaveBeenCalled();
  });
});
