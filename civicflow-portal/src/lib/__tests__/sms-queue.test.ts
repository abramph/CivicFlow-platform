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

const ALLOWED = { allowed: true, reason: null, trialEndsAt: null, subscriptionStatus: null, billingExempt: false } as const;

import { attemptSmsMessageResend, processRetryableSmsMessages } from "@/lib/sms-queue";

describe("attemptSmsMessageResend", () => {
  beforeEach(() => {
    updateSmsMessage.mockReset();
    sendSms.mockReset();
    resolveOrganizationAccess.mockReset().mockResolvedValue(ALLOWED);
  });

  it("marks SENT on a successful resend", async () => {
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM1" });
    updateSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "SENT" });

    await attemptSmsMessageResend({ id: "msg-1", organizationId: "org-a", phone: "+15551234567", body: "hi" });

    expect(updateSmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { status: "SENT", sentAt: expect.any(Date), providerMessageId: "SM1", errorMessage: null },
    });
  });

  it("marks FAILED with the failure reason on an unsuccessful resend", async () => {
    sendSms.mockResolvedValueOnce({ sent: false, skipped: false, to: "+15551234567", reason: "carrier rejected" });
    updateSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "FAILED" });

    await attemptSmsMessageResend({ id: "msg-1", organizationId: "org-a", phone: "+15551234567", body: "hi" });

    expect(updateSmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { status: "FAILED", errorMessage: "carrier rejected" },
    });
  });

  it("LAUNCH-BLOCKER: marks FAILED without calling sendSms when the organization is billing-inactive — applies to the manual Retry button too, since it shares this function", async () => {
    resolveOrganizationAccess.mockResolvedValueOnce({ allowed: false, reason: "TRIAL_EXPIRED", trialEndsAt: null, subscriptionStatus: null, billingExempt: false });
    updateSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "FAILED" });

    await attemptSmsMessageResend({ id: "msg-1", organizationId: "org-a", phone: "+15551234567", body: "hi" });

    expect(sendSms).not.toHaveBeenCalled();
    expect(updateSmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { status: "FAILED", errorMessage: "Organization subscription is not active." },
    });
  });
});

describe("processRetryableSmsMessages", () => {
  beforeEach(() => {
    findManySmsMessage.mockReset();
    updateSmsMessage.mockReset();
    sendSms.mockReset();
    resolveOrganizationAccess.mockReset().mockResolvedValue(ALLOWED);
  });

  it("processes every due RETRYING message", async () => {
    findManySmsMessage.mockResolvedValueOnce([
      { id: "msg-1", organizationId: "org-a", phone: "+15551234567", body: "a" },
      { id: "msg-2", organizationId: "org-b", phone: "+15559876543", body: "b" },
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

  it("returns processed: 0 when nothing is due", async () => {
    findManySmsMessage.mockResolvedValueOnce([]);
    const result = await processRetryableSmsMessages();
    expect(result.processed).toBe(0);
    expect(sendSms).not.toHaveBeenCalled();
  });
});
