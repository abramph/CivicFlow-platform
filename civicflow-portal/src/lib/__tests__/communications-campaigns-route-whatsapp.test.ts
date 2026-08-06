import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "staff-1", userEmail: "staff@org-a.example.com" },
      organizationId: "org-a",
      role: "ORG_ADMIN",
    }),
  };
});

const createCampaign = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    communicationCampaign: {
      create: (...args: unknown[]) => createCampaign(...args),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

const resolveCommunicationRecipients = vi.fn().mockResolvedValue([]);
const sendCommunicationCampaign = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/communication-campaigns", () => ({
  resolveCommunicationRecipients: (...args: unknown[]) => resolveCommunicationRecipients(...args),
  sendCommunicationCampaign: (...args: unknown[]) => sendCommunicationCampaign(...args),
}));

vi.mock("@/lib/deep-links", () => ({ validateDeepLink: (link: string) => link }));
vi.mock("@/lib/sms-entitlement", () => ({ getSmsEntitlement: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock("@/lib/plan-gate", () => ({ requirePlanFeature: vi.fn().mockResolvedValue(undefined) }));

const getWhatsAppEntitlement = vi.fn();
vi.mock("@/lib/whatsapp/entitlement", () => ({ getWhatsAppEntitlement: (...args: unknown[]) => getWhatsAppEntitlement(...args) }));

const getActiveTemplate = vi.fn();
const validateTemplateVariables = vi.fn();
vi.mock("@/lib/whatsapp/templates", () => ({
  getActiveTemplate: (...args: unknown[]) => getActiveTemplate(...args),
  validateTemplateVariables: (...args: unknown[]) => validateTemplateVariables(...args),
}));

import { POST } from "@/app/api/communications/campaigns/route";

function postRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/communications/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "Meeting reminder",
    communicationType: "GENERAL",
    channel: "INTERNAL_LOG_ONLY",
    subject: "Subject",
    body: "Body",
    ...overrides,
  };
}

describe("POST /api/communications/campaigns — WhatsApp validation", () => {
  beforeEach(() => {
    createCampaign.mockReset();
    createCampaign.mockResolvedValue({ id: "campaign-1", channel: "INTERNAL_LOG_ONLY", whatsappTemplateKey: "meeting_reminder" });
    resolveCommunicationRecipients.mockClear();
    resolveCommunicationRecipients.mockResolvedValue([]);
    getWhatsAppEntitlement.mockReset();
    getActiveTemplate.mockReset();
    validateTemplateVariables.mockReset();
  });

  it("rejects whatsappEnabled without an entitlement, never creating the campaign", async () => {
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: false, reason: "Your organization does not have the WhatsApp add-on enabled." });

    const response = await POST(postRequest(baseBody({ whatsappEnabled: true, whatsappTemplateKey: "meeting_reminder" })));

    expect(response.status).toBe(400);
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it("rejects whatsappEnabled with no template key selected", async () => {
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true });

    const response = await POST(postRequest(baseBody({ whatsappEnabled: true })));

    expect(response.status).toBe(400);
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it("rejects a template key that doesn't resolve to an active, approved template", async () => {
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true });
    getActiveTemplate.mockResolvedValueOnce(null);

    const response = await POST(postRequest(baseBody({ whatsappEnabled: true, whatsappTemplateKey: "not_a_real_template" })));

    expect(response.status).toBe(400);
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it("rejects when template variables fail validation", async () => {
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true });
    getActiveTemplate.mockResolvedValueOnce({ key: "meeting_reminder" });
    validateTemplateVariables.mockReturnValueOnce({ valid: false, reason: 'Missing required template variable "meetingDate".' });

    const response = await POST(postRequest(baseBody({ whatsappEnabled: true, whatsappTemplateKey: "meeting_reminder", whatsappTemplateVariables: {} })));

    expect(response.status).toBe(400);
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it("creates the campaign with the validated template variables when everything checks out", async () => {
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true });
    getActiveTemplate.mockResolvedValueOnce({ key: "meeting_reminder" });
    validateTemplateVariables.mockReturnValueOnce({ valid: true, variables: { meetingDate: "Aug 10" } });

    const response = await POST(
      postRequest(baseBody({ whatsappEnabled: true, whatsappTemplateKey: "meeting_reminder", whatsappTemplateVariables: { meetingDate: "Aug 10", extra: "dropped-by-server-anyway" } }))
    );

    expect(response.status).toBe(201);
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          whatsappEnabled: true,
          whatsappTemplateKey: "meeting_reminder",
          whatsappTemplateVariables: { meetingDate: "Aug 10" },
        }),
      })
    );
  });

  it("never calls the WhatsApp entitlement/template checks when whatsappEnabled is false", async () => {
    const response = await POST(postRequest(baseBody({ whatsappEnabled: false })));

    expect(response.status).toBe(201);
    expect(getWhatsAppEntitlement).not.toHaveBeenCalled();
    expect(getActiveTemplate).not.toHaveBeenCalled();
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ whatsappEnabled: false, whatsappTemplateKey: null }) })
    );
  });
});
