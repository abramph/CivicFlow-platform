import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyReminderLog = vi.fn();
const updateReminderLog = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailReminderLog: {
      findMany: (...args: unknown[]) => findManyReminderLog(...args),
      update: (...args: unknown[]) => updateReminderLog(...args),
    },
    contributionReceipt: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

const sendReminderEmail = vi.fn();
const sendReceiptEmail = vi.fn();
vi.mock("@/lib/mail", () => ({
  sendReminderEmail: (...args: unknown[]) => sendReminderEmail(...args),
  sendReceiptEmail: (...args: unknown[]) => sendReceiptEmail(...args),
}));

const createAuditEvent = vi.fn();
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

vi.mock("@/lib/storage", () => ({ getSignedObjectUrl: vi.fn().mockResolvedValue("https://signed.example/file") }));

const resolveOrganizationAccess = vi.fn();
vi.mock("@/lib/subscription-gate", () => ({
  resolveOrganizationAccess: (...args: unknown[]) => resolveOrganizationAccess(...args),
}));
const ALLOWED = { allowed: true, reason: null, trialEndsAt: null, subscriptionStatus: null, billingExempt: false } as const;

import { processPendingReminderLogs } from "@/lib/reminders";

function makeLog(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    organizationId: "org-a",
    memberId: "member-1",
    reminderType: "DUES_UPCOMING",
    recipientEmail: "member@example.com",
    subject: "Reminder",
    bodyPreview: null,
    createdByUserId: "user-1",
    member: { email: "member@example.com" },
    ...overrides,
  };
}

describe("processPendingReminderLogs", () => {
  beforeEach(() => {
    findManyReminderLog.mockReset();
    updateReminderLog.mockReset();
    sendReminderEmail.mockReset();
    sendReceiptEmail.mockReset();
    createAuditEvent.mockReset();
    resolveOrganizationAccess.mockReset();
    resolveOrganizationAccess.mockResolvedValue(ALLOWED);
  });

  it("sends a queued reminder and marks it SENT", async () => {
    findManyReminderLog.mockResolvedValueOnce([makeLog()]);
    sendReminderEmail.mockResolvedValueOnce(undefined);
    updateReminderLog.mockResolvedValueOnce({});

    await processPendingReminderLogs();

    expect(sendReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "member@example.com", reminderType: "DUES_UPCOMING" })
    );
    expect(updateReminderLog).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { status: "SENT", sentAt: expect.any(Date), errorMessage: null },
    });
  });

  it("LAUNCH-BLOCKER: marks FAILED without attempting to send when the organization is billing-inactive", async () => {
    findManyReminderLog.mockResolvedValueOnce([makeLog()]);
    resolveOrganizationAccess.mockResolvedValueOnce({
      allowed: false,
      reason: "SUBSCRIPTION_CANCELED",
      trialEndsAt: null,
      subscriptionStatus: "cancelled",
      billingExempt: false,
    });

    await processPendingReminderLogs();

    expect(sendReminderEmail).not.toHaveBeenCalled();
    expect(updateReminderLog).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { status: "FAILED", errorMessage: "Organization subscription is not active." },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "log-1",
        metadata: expect.objectContaining({ status: "FAILED", reason: "organization_subscription_required" }),
      })
    );
  });

  it("still marks SKIPPED for a genuinely missing recipient when the organization is allowed", async () => {
    findManyReminderLog.mockResolvedValueOnce([makeLog({ recipientEmail: null, member: null })]);
    updateReminderLog.mockResolvedValueOnce({});

    await processPendingReminderLogs();

    expect(sendReminderEmail).not.toHaveBeenCalled();
    expect(updateReminderLog).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { status: "SKIPPED", errorMessage: "No recipient email available" },
    });
  });
});
