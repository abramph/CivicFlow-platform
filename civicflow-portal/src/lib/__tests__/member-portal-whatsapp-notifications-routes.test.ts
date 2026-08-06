import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMemberWebSession = vi.fn().mockResolvedValue({ userId: "user-1", memberId: "member-1", organizationId: "org-a" });
vi.mock("@/lib/member-web-session", () => ({ requireMemberWebSession: (...args: unknown[]) => requireMemberWebSession(...args) }));

vi.mock("@/lib/rate-limit", () => ({
  requireRateLimit: vi.fn().mockResolvedValue(null),
  getClientIp: () => "203.0.113.5",
}));

const findUniqueOrgMember = vi.fn();
const updateOrgMember = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: {
      findUnique: (...args: unknown[]) => findUniqueOrgMember(...args),
      update: (...args: unknown[]) => updateOrgMember(...args),
    },
  },
}));

const recordWhatsAppOptIn = vi.fn().mockResolvedValue({ id: "member-1" });
const recordWhatsAppOptOut = vi.fn().mockResolvedValue({ id: "member-1" });
vi.mock("@/lib/whatsapp-consent", () => ({
  recordWhatsAppOptIn: (...args: unknown[]) => recordWhatsAppOptIn(...args),
  recordWhatsAppOptOut: (...args: unknown[]) => recordWhatsAppOptOut(...args),
}));

function jsonRequest(url: string, body: Record<string, unknown>, method = "POST") {
  return new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /api/member-portal/notifications/whatsapp/opt-in", () => {
  beforeEach(() => {
    recordWhatsAppOptIn.mockClear();
  });

  it("rejects an invalid phone number before recording consent", async () => {
    const { POST } = await import("@/app/api/member-portal/notifications/whatsapp/opt-in/route");
    const response = await POST(
      jsonRequest("https://portal.test/api/member-portal/notifications/whatsapp/opt-in", {
        organizationId: "org-a",
        phone: "not-a-phone",
        consentAccepted: true,
      })
    );
    expect(response.status).toBe(400);
    expect(recordWhatsAppOptIn).not.toHaveBeenCalled();
  });

  it("normalizes the phone and records consent with SELF_SERVICE source and the caller's IP", async () => {
    const { POST } = await import("@/app/api/member-portal/notifications/whatsapp/opt-in/route");
    const response = await POST(
      jsonRequest("https://portal.test/api/member-portal/notifications/whatsapp/opt-in", {
        organizationId: "org-a",
        phone: "215-917-4391",
        consentAccepted: true,
      })
    );
    expect(response.status).toBe(200);
    expect(recordWhatsAppOptIn).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", memberId: "member-1", phone: "+12159174391", source: "SELF_SERVICE", ip: "203.0.113.5" })
    );
  });
});

describe("PUT /api/member-portal/notifications/whatsapp/toggle", () => {
  beforeEach(() => {
    findUniqueOrgMember.mockReset();
    updateOrgMember.mockClear();
  });

  it("rejects toggling when the member hasn't opted in", async () => {
    findUniqueOrgMember.mockResolvedValueOnce({ whatsappOptInStatus: "NOT_STARTED" });
    const { PUT } = await import("@/app/api/member-portal/notifications/whatsapp/toggle/route");
    const response = await PUT(
      jsonRequest("https://portal.test/api/member-portal/notifications/whatsapp/toggle", { organizationId: "org-a", enabled: true }, "PUT")
    );
    expect(response.status).toBe(400);
    expect(updateOrgMember).not.toHaveBeenCalled();
  });

  it("updates whatsappEnabled when the member has opted in", async () => {
    findUniqueOrgMember.mockResolvedValueOnce({ whatsappOptInStatus: "OPTED_IN" });
    const { PUT } = await import("@/app/api/member-portal/notifications/whatsapp/toggle/route");
    const response = await PUT(
      jsonRequest("https://portal.test/api/member-portal/notifications/whatsapp/toggle", { organizationId: "org-a", enabled: false }, "PUT")
    );
    expect(response.status).toBe(200);
    expect(updateOrgMember).toHaveBeenCalledWith({ where: { id: "member-1" }, data: { whatsappEnabled: false } });
  });
});

describe("POST /api/member-portal/notifications/whatsapp/withdraw", () => {
  beforeEach(() => {
    recordWhatsAppOptOut.mockClear();
  });

  it("withdraws consent with self_service source", async () => {
    const { POST } = await import("@/app/api/member-portal/notifications/whatsapp/withdraw/route");
    const response = await POST(
      jsonRequest("https://portal.test/api/member-portal/notifications/whatsapp/withdraw", { organizationId: "org-a" })
    );
    expect(response.status).toBe(200);
    expect(recordWhatsAppOptOut).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", memberId: "member-1", source: "self_service" })
    );
  });
});
