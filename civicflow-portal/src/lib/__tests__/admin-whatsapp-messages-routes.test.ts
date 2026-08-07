import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSuperAdmin = vi.fn();
vi.mock("@/lib/auth-guards", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth-guards")>("@/lib/auth-guards");
  return { ...actual, requireSuperAdmin: (...args: unknown[]) => requireSuperAdmin(...args) };
});

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const findUniqueWhatsAppMessage = vi.fn();
const updateWhatsAppMessage = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsAppMessage: {
      findUnique: (...args: unknown[]) => findUniqueWhatsAppMessage(...args),
      update: (...args: unknown[]) => updateWhatsAppMessage(...args),
    },
  },
}));

const sendWhatsAppMessage = vi.fn();
vi.mock("@/lib/whatsapp/send", () => ({ sendWhatsAppMessage: (...args: unknown[]) => sendWhatsAppMessage(...args) }));

import { POST as retry } from "@/app/api/admin/whatsapp/messages/[id]/retry/route";
import { POST as cancel } from "@/app/api/admin/whatsapp/messages/[id]/cancel/route";

const session = { userId: "user-1", userEmail: "admin@example.com" };
const params = { params: Promise.resolve({ id: "msg-1" }) };

describe("POST /api/admin/whatsapp/messages/[id]/retry", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    requireSuperAdmin.mockResolvedValue({ session });
    findUniqueWhatsAppMessage.mockReset();
    updateWhatsAppMessage.mockReset();
    sendWhatsAppMessage.mockReset();
    createAuditEvent.mockClear();
  });

  it("requires SUPER_ADMIN", async () => {
    const { ForbiddenError } = await import("@/lib/auth-guards");
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError("Permission denied"));
    const response = await retry(new Request("https://x"), params);
    expect(response.status).toBe(403);
    expect(findUniqueWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("rejects retrying a message that isn't FAILED", async () => {
    findUniqueWhatsAppMessage.mockResolvedValueOnce({ id: "msg-1", status: "SENT" });
    const response = await retry(new Request("https://x"), params);
    expect(response.status).toBe(400);
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("rejects retrying a template-based message (body is null)", async () => {
    findUniqueWhatsAppMessage.mockResolvedValueOnce({ id: "msg-1", status: "FAILED", phone: "+15551234567", body: null, organizationId: "org-1" });
    updateWhatsAppMessage.mockResolvedValueOnce({});
    const response = await retry(new Request("https://x"), params);
    expect(response.status).toBe(400);
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("resends a FAILED freeform message and marks it SENT on success", async () => {
    findUniqueWhatsAppMessage.mockResolvedValueOnce({
      id: "msg-1",
      status: "FAILED",
      phone: "+15551234567",
      body: "hi",
      organizationId: "org-1",
    });
    updateWhatsAppMessage.mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "msg-1", status: "SENT" });
    sendWhatsAppMessage.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM99" });

    const response = await retry(new Request("https://x"), params);
    const payload = await response.json();

    expect(sendWhatsAppMessage).toHaveBeenCalledWith({ to: "+15551234567", body: "hi" });
    expect(payload.data.status).toBe("SENT");
    expect(updateWhatsAppMessage).toHaveBeenNthCalledWith(1, {
      where: { id: "msg-1" },
      data: { status: "SENDING", retryCount: { increment: 1 }, nextRetryAt: expect.any(Date) },
    });
    expect(updateWhatsAppMessage).toHaveBeenNthCalledWith(2, {
      where: { id: "msg-1" },
      data: { status: "SENT", sentAt: expect.any(Date), providerMessageId: "SM99", errorMessage: null },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", action: "whatsapp_admin.message_retried" })
    );
  });

  it("marks FAILED again with the new reason when the retry also fails", async () => {
    findUniqueWhatsAppMessage.mockResolvedValueOnce({
      id: "msg-1",
      status: "FAILED",
      phone: "+15551234567",
      body: "hi",
      organizationId: "org-1",
    });
    updateWhatsAppMessage.mockResolvedValueOnce({}).mockResolvedValueOnce({ id: "msg-1", status: "FAILED" });
    sendWhatsAppMessage.mockResolvedValueOnce({ sent: false, skipped: false, to: "+15551234567", reason: "Still failing" });

    await retry(new Request("https://x"), params);

    expect(updateWhatsAppMessage).toHaveBeenNthCalledWith(2, {
      where: { id: "msg-1" },
      data: { status: "FAILED", errorMessage: "Still failing" },
    });
  });
});

describe("POST /api/admin/whatsapp/messages/[id]/cancel", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    requireSuperAdmin.mockResolvedValue({ session });
    findUniqueWhatsAppMessage.mockReset();
    updateWhatsAppMessage.mockReset();
    createAuditEvent.mockClear();
  });

  it("requires SUPER_ADMIN", async () => {
    const { ForbiddenError } = await import("@/lib/auth-guards");
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError("Permission denied"));
    const response = await cancel(new Request("https://x"), params);
    expect(response.status).toBe(403);
  });

  it("rejects cancelling a message that's already terminal", async () => {
    findUniqueWhatsAppMessage.mockResolvedValueOnce({ id: "msg-1", status: "SENT" });
    const response = await cancel(new Request("https://x"), params);
    expect(response.status).toBe(400);
    expect(updateWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("cancels a QUEUED message without attempting a send", async () => {
    findUniqueWhatsAppMessage.mockResolvedValueOnce({ id: "msg-1", status: "QUEUED", organizationId: "org-1" });
    updateWhatsAppMessage.mockResolvedValueOnce({ id: "msg-1", status: "FAILED" });

    const response = await cancel(new Request("https://x"), params);
    const payload = await response.json();

    expect(payload.data.status).toBe("FAILED");
    expect(updateWhatsAppMessage).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { status: "FAILED", failedAt: expect.any(Date), errorMessage: "Cancelled by admin." },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", action: "whatsapp_admin.message_cancelled" })
    );
  });

  it("cancels a SENDING (in-flight retry) message", async () => {
    findUniqueWhatsAppMessage.mockResolvedValueOnce({ id: "msg-1", status: "SENDING", organizationId: "org-1" });
    updateWhatsAppMessage.mockResolvedValueOnce({ id: "msg-1", status: "FAILED" });

    const response = await cancel(new Request("https://x"), params);
    expect(response.status).toBe(200);
  });
});
