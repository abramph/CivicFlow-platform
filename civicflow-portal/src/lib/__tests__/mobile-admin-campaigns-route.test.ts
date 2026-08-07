import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobileAuth = vi.fn();
vi.mock("@/lib/mobile-auth", () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
  MobileAuthError: class MobileAuthError extends Error {
    status = 401;
  },
  MobileForbiddenError: class MobileForbiddenError extends Error {
    status = 403;
  },
}));

const resolveMobileAdminCapabilities = vi.fn();
vi.mock("@/lib/mobile-admin", () => ({
  resolveMobileAdminCapabilities: (...args: unknown[]) => resolveMobileAdminCapabilities(...args),
}));

const findManyCampaign = vi.fn();
const createCampaignPrisma = vi.fn();
const findFirstCampaign = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    communicationCampaign: {
      findMany: (...a: unknown[]) => findManyCampaign(...a),
      create: (...a: unknown[]) => createCampaignPrisma(...a),
      findFirst: (...a: unknown[]) => findFirstCampaign(...a),
    },
  },
}));

const resolveCommunicationRecipients = vi.fn();
const sendCommunicationCampaign = vi.fn();
vi.mock("@/lib/communication-campaigns", () => ({
  resolveCommunicationRecipients: (...a: unknown[]) => resolveCommunicationRecipients(...a),
  sendCommunicationCampaign: (...a: unknown[]) => sendCommunicationCampaign(...a),
}));

vi.mock("@/lib/deep-links", () => ({ validateDeepLink: (v: string) => v }));
vi.mock("@/lib/sms-entitlement", () => ({ getSmsEntitlement: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock("@/lib/plan-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan-gate")>();
  return { ...actual, requirePlanFeature: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@/lib/whatsapp/entitlement", () => ({ getWhatsAppEntitlement: vi.fn().mockResolvedValue({ allowed: false }) }));
vi.mock("@/lib/whatsapp/templates", () => ({ getActiveTemplate: vi.fn(), validateTemplateVariables: vi.fn() }));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET, POST } from "@/app/api/mobile/admin/campaigns/route";
import { GET as detailGet } from "@/app/api/mobile/admin/campaigns/[campaignId]/route";
import { POST as sendPost } from "@/app/api/mobile/admin/campaigns/[campaignId]/send/route";

function listRequest(qs = "organizationId=org-a") {
  return new Request(`https://portal.test/api/mobile/admin/campaigns?${qs}`, { headers: { Authorization: "Bearer test-token" } });
}
function createRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/mobile/admin/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}
function sendRequest(body: Record<string, unknown> = { organizationId: "org-a" }) {
  return new Request("https://portal.test/api/mobile/admin/campaigns/camp-1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}
function sendParams() {
  return { params: Promise.resolve({ campaignId: "camp-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
  resolveCommunicationRecipients.mockResolvedValue([]);
});

describe("GET /api/mobile/admin/campaigns", () => {
  it("returns 403 without manageCommunications", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageEvents"] });

    const response = await GET(listRequest());
    expect(response.status).toBe(403);
    expect(findManyCampaign).not.toHaveBeenCalled();
  });

  it("lists campaigns scoped to the requested organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageCommunications"] });
    findManyCampaign.mockResolvedValueOnce([{ id: "camp-1", title: "Fall Newsletter" }]);

    const response = await GET(listRequest("organizationId=org-a"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(findManyCampaign).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a" } }));
    expect(body.data).toEqual([{ id: "camp-1", title: "Fall Newsletter" }]);
  });
});

describe("POST /api/mobile/admin/campaigns", () => {
  it("rejects a crafted organizationId with no real capability, resolved fresh per request", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    await POST(
      createRequest({ organizationId: "org-victim", title: "Newsletter", communicationType: "GENERAL", channel: "INTERNAL_LOG_ONLY", subject: "Hi", body: "Body text" })
    );

    expect(resolveMobileAdminCapabilities).toHaveBeenCalledWith("org-victim", "user-1");
    expect(createCampaignPrisma).not.toHaveBeenCalled();
  });

  it("creates a campaign using the same createCommunicationCampaign() service the web form uses", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageCommunications"] });
    createCampaignPrisma.mockResolvedValueOnce({ id: "camp-new", organizationId: "org-a", title: "Newsletter", channel: "INTERNAL_LOG_ONLY" });

    const response = await POST(
      createRequest({ organizationId: "org-a", title: "Newsletter", communicationType: "GENERAL", channel: "INTERNAL_LOG_ONLY", subject: "Hi", body: "Body text" })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe("camp-new");
  });

  it("does not send when sendNow is not set", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageCommunications"] });
    createCampaignPrisma.mockResolvedValueOnce({ id: "camp-new", organizationId: "org-a" });

    await POST(createRequest({ organizationId: "org-a", title: "Newsletter", communicationType: "GENERAL", channel: "INTERNAL_LOG_ONLY", subject: "Hi", body: "Body text" }));

    expect(sendCommunicationCampaign).not.toHaveBeenCalled();
  });

  it("sends immediately when sendNow is true", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageCommunications"] });
    createCampaignPrisma.mockResolvedValueOnce({ id: "camp-new", organizationId: "org-a" });

    await POST(
      createRequest({ organizationId: "org-a", title: "Newsletter", communicationType: "GENERAL", channel: "INTERNAL_LOG_ONLY", subject: "Hi", body: "Body text", sendNow: true })
    );

    expect(sendCommunicationCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", campaignId: "camp-new", actorUserId: "user-1" })
    );
  });
});

describe("GET /api/mobile/admin/campaigns/[campaignId]", () => {
  function detailRequest(qs = "organizationId=org-a") {
    return new Request(`https://portal.test/api/mobile/admin/campaigns/camp-1?${qs}`, { headers: { Authorization: "Bearer test-token" } });
  }
  function detailParams() {
    return { params: Promise.resolve({ campaignId: "camp-1" }) };
  }

  it("returns 404 for a campaign belonging to a different organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageCommunications"] });
    findFirstCampaign.mockResolvedValueOnce(null);

    const response = await detailGet(detailRequest(), detailParams());
    expect(response.status).toBe(404);
    expect(findFirstCampaign).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "camp-1", organizationId: "org-a" } }));
  });

  it("returns the campaign scoped to the requested organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageCommunications"] });
    findFirstCampaign.mockResolvedValueOnce({ id: "camp-1", title: "Fall Newsletter", status: "DRAFT" });

    const response = await detailGet(detailRequest(), detailParams());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.title).toBe("Fall Newsletter");
  });
});

describe("POST /api/mobile/admin/campaigns/[campaignId]/send", () => {
  it("returns 403 without manageCommunications", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    const response = await sendPost(sendRequest(), sendParams());
    expect(response.status).toBe(403);
    expect(sendCommunicationCampaign).not.toHaveBeenCalled();
  });

  it("delegates to the exact same sendCommunicationCampaign() the web Send button uses", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageCommunications"] });
    sendCommunicationCampaign.mockResolvedValueOnce({ sent: 5, skipped: 0, failed: 0 });

    const response = await sendPost(sendRequest(), sendParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.sent).toBe(5);
    expect(sendCommunicationCampaign).toHaveBeenCalledWith({ organizationId: "org-a", campaignId: "camp-1", actorUserId: "user-1", actorEmail: "officer@example.com" });
  });
});
