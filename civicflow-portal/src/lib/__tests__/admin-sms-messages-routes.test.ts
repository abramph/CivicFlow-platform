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

// Retry ownership and execution are fully centralized in the sms-queue
// claimant (own suite: sms-queue.test.ts + the real-database lease suite);
// the route's job is eligibility, delegation, and once-per-claim auditing.
const executeClaimedSmsRetry = vi.fn();
vi.mock("@/lib/sms-queue", () => ({
  executeClaimedSmsRetry: (...args: unknown[]) => executeClaimedSmsRetry(...args),
}));

import { POST as retry } from "@/app/api/admin/sms/messages/[id]/retry/route";
import { POST as cancel } from "@/app/api/admin/sms/messages/[id]/cancel/route";

const session = { userId: "user-1", userEmail: "admin@example.com" };
const params = { params: Promise.resolve({ id: "msg-1" }) };

const FAILED_ROW = { id: "msg-1", status: "FAILED", phone: "+15551234567", body: "hi", organizationId: "org-1", memberId: "member-1" };

describe("POST /api/admin/sms/messages/[id]/retry", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    requireSuperAdmin.mockResolvedValue({ session });
    findUniqueSmsMessage.mockReset();
    updateSmsMessage.mockReset();
    updateManySmsMessage.mockReset();
    executeClaimedSmsRetry.mockReset();
    createAuditEvent.mockClear();
  });

  it("rejects retrying a message that isn't FAILED — the eligibility CAS matches nothing", async () => {
    findUniqueSmsMessage.mockResolvedValueOnce({ id: "msg-1", status: "SENT" });
    updateManySmsMessage.mockResolvedValueOnce({ count: 0 });

    const response = await retry(new Request("https://x"), params);

    expect(response.status).toBe(400);
    expect(executeClaimedSmsRetry).not.toHaveBeenCalled();
  });

  it("makes the row eligible (RETRYING, immediately due, NO retryCount increment) then delegates to the centralized claimant, auditing once", async () => {
    findUniqueSmsMessage.mockResolvedValueOnce(FAILED_ROW);
    updateManySmsMessage.mockResolvedValueOnce({ count: 1 });
    executeClaimedSmsRetry.mockResolvedValueOnce({ claimed: true, message: { ...FAILED_ROW, status: "SENT" } });

    const response = await retry(new Request("https://x"), params);
    const payload = await response.json();

    expect(updateManySmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1", status: "FAILED" },
      // retryCount deliberately absent: it increments inside the claim CAS,
      // once per actual claimed attempt — never per competing request.
      data: { status: "RETRYING", nextRetryAt: expect.any(Date) },
    });
    expect(executeClaimedSmsRetry).toHaveBeenCalledWith("msg-1");
    expect(payload.data.status).toBe("SENT");
    expect(createAuditEvent).toHaveBeenCalledTimes(1);
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", action: "sms_admin.message_retried", metadata: { sent: true } })
    );
  });

  it("reports a failed retry outcome with sent:false in the single audit event", async () => {
    findUniqueSmsMessage.mockResolvedValue(FAILED_ROW);
    updateManySmsMessage.mockResolvedValueOnce({ count: 1 });
    executeClaimedSmsRetry.mockResolvedValueOnce({ claimed: true, message: { ...FAILED_ROW, status: "FAILED", errorMessage: "Still failing" } });

    await retry(new Request("https://x"), params);

    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: { sent: false } }));
  });

  it("RACE with cron: when the sweep wins the claim first, the route neither audits nor double-executes — the attempt has exactly one owner", async () => {
    findUniqueSmsMessage.mockResolvedValueOnce(FAILED_ROW);
    updateManySmsMessage.mockResolvedValueOnce({ count: 1 });
    executeClaimedSmsRetry.mockResolvedValueOnce({ claimed: false });
    findUniqueSmsMessage.mockResolvedValueOnce({ ...FAILED_ROW, status: "SENDING" });

    const response = await retry(new Request("https://x"), params);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.alreadyClaimed).toBe(true);
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("E2E-6 finding: closes a TOCTOU race — a second concurrent retry for the same message loses the eligibility CAS (count 0) and fails cleanly instead of double-sending", async () => {
    findUniqueSmsMessage.mockResolvedValueOnce(FAILED_ROW);
    // Simulate the second of two concurrent requests: the first request's
    // updateMany already flipped the row to RETRYING, so this one's
    // FAILED-scoped where clause matches nothing.
    updateManySmsMessage.mockResolvedValueOnce({ count: 0 });

    const response = await retry(new Request("https://x"), params);

    expect(response.status).toBe(400);
    expect(executeClaimedSmsRetry).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
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
