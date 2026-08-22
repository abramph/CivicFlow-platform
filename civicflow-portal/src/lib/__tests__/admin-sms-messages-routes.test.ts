import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSuperAdmin = vi.fn();
vi.mock("@/lib/auth-guards", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth-guards")>("@/lib/auth-guards");
  return { ...actual, requireSuperAdmin: (...args: unknown[]) => requireSuperAdmin(...args) };
});

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const findUniqueSmsMessage = vi.fn();
const updateSmsMessage = vi.fn();
const updateManySmsMessage = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    smsMessage: {
      findUnique: (...args: unknown[]) => findUniqueSmsMessage(...args),
      update: (...args: unknown[]) => updateSmsMessage(...args),
      updateMany: (...args: unknown[]) => updateManySmsMessage(...args),
    },
  },
}));

const sendSms = vi.fn();
vi.mock("@/lib/sms", () => ({ sendSms: (...args: unknown[]) => sendSms(...args) }));

// This suite tests the retry/cancel routes, not the subscription gate —
// assume every organization is allowed.
vi.mock("@/lib/subscription-gate", () => ({
  resolveOrganizationAccess: vi.fn().mockResolvedValue({
    allowed: true,
    reason: null,
    trialEndsAt: null,
    subscriptionStatus: null,
    billingExempt: false,
  }),
}));

import { POST as retry } from "@/app/api/admin/sms/messages/[id]/retry/route";
import { POST as cancel } from "@/app/api/admin/sms/messages/[id]/cancel/route";

const session = { userId: "user-1", userEmail: "admin@example.com" };
const params = { params: Promise.resolve({ id: "msg-1" }) };

describe("POST /api/admin/sms/messages/[id]/retry", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    requireSuperAdmin.mockResolvedValue({ session });
    findUniqueSmsMessage.mockReset();
    updateSmsMessage.mockReset();
    updateManySmsMessage.mockReset();
    sendSms.mockReset();
    createAuditEvent.mockClear();
  });

  it("rejects retrying a message that isn't FAILED", async () => {
    findUniqueSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "SENT" });
    updateManySmsMessage.mockResolvedValueOnce({ count: 0 });
    const response = await retry(new Request("https://x"), params);
    expect(response.status).toBe(400);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("resends a FAILED message and marks it SENT on success", async () => {
    findUniqueSmsMessage.mockResolvedValueOnce({
      id: "msg-1",
      status: "FAILED",
      phone: "+15551234567",
      body: "hi",
      organizationId: "org-1",
    });
    updateManySmsMessage.mockResolvedValueOnce({ count: 1 });
    updateSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "SENT" });
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM99" });

    const response = await retry(new Request("https://x"), params);
    const payload = await response.json();

    expect(sendSms).toHaveBeenCalledWith({ to: "+15551234567", body: "hi" });
    expect(payload.data.status).toBe("SENT");
    expect(updateManySmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1", status: "FAILED" },
      data: { status: "RETRYING", retryCount: { increment: 1 }, nextRetryAt: expect.any(Date) },
    });
    expect(updateSmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { status: "SENT", sentAt: expect.any(Date), providerMessageId: "SM99", errorMessage: null },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }));
  });

  it("marks FAILED again with the new reason when the retry also fails", async () => {
    findUniqueSmsMessage.mockResolvedValueOnce({
      id: "msg-1",
      status: "FAILED",
      phone: "+15551234567",
      body: "hi",
      organizationId: "org-1",
    });
    updateManySmsMessage.mockResolvedValueOnce({ count: 1 });
    updateSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "FAILED" });
    sendSms.mockResolvedValueOnce({ sent: false, skipped: false, to: "+15551234567", reason: "Still failing" });

    await retry(new Request("https://x"), params);

    expect(updateSmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { status: "FAILED", errorMessage: "Still failing" },
    });
  });

  it("E2E-6 finding: closes a TOCTOU race — a second concurrent retry for the same message loses the atomic claim (count 0) and fails cleanly instead of double-sending", async () => {
    findUniqueSmsMessage.mockResolvedValueOnce({
      id: "msg-1",
      status: "FAILED",
      phone: "+15551234567",
      body: "hi",
      organizationId: "org-1",
    });
    // Simulate the second of two concurrent requests: the first request's
    // updateMany already flipped the row to RETRYING, so this one's
    // FAILED-scoped where clause matches nothing.
    updateManySmsMessage.mockResolvedValueOnce({ count: 0 });

    const response = await retry(new Request("https://x"), params);

    expect(response.status).toBe(400);
    expect(sendSms).not.toHaveBeenCalled();
    expect(updateSmsMessage).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/sms/messages/[id]/cancel", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    requireSuperAdmin.mockResolvedValue({ session });
    findUniqueSmsMessage.mockReset();
    updateSmsMessage.mockReset();
    createAuditEvent.mockClear();
  });

  it("rejects cancelling a message that's already terminal", async () => {
    findUniqueSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "SENT" });
    const response = await cancel(new Request("https://x"), params);
    expect(response.status).toBe(400);
    expect(updateSmsMessage).not.toHaveBeenCalled();
  });

  it("cancels a QUEUED message without attempting a send", async () => {
    findUniqueSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "QUEUED", organizationId: "org-1" });
    updateSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "FAILED" });

    const response = await cancel(new Request("https://x"), params);
    const payload = await response.json();

    expect(payload.data.status).toBe("FAILED");
    expect(updateSmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { status: "FAILED", errorMessage: "Cancelled by admin." },
    });
  });
});
