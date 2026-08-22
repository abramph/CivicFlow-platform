import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstCampaign = vi.fn();
const findManyCampaign = vi.fn().mockResolvedValue([]);
const updateCampaign = vi.fn().mockResolvedValue(undefined);
const updateManyCampaign = vi.fn().mockResolvedValue({ count: 1 });
const findManyRecipient = vi.fn().mockResolvedValue([]);
const countRecipient = vi.fn().mockResolvedValue(0);
const updateRecipient = vi.fn().mockResolvedValue(undefined);
const findUniqueOrganization = vi.fn().mockResolvedValue({ name: "ThrivePath Foundation" });
const findUniqueOrgSettings = vi.fn().mockResolvedValue({ timezone: "America/New_York" });
const findUniqueWhatsAppSettings = vi.fn().mockResolvedValue({ quietHoursStartHour: 21, quietHoursEndHour: 8 });
const findManyAttachment = vi.fn().mockResolvedValue([]);
const findManyDeviceToken = vi.fn().mockResolvedValue([]);
const createCommunicationLog = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    communicationCampaign: {
      findFirst: (...args: unknown[]) => findFirstCampaign(...args),
      findMany: (...args: unknown[]) => findManyCampaign(...args),
      update: (...args: unknown[]) => updateCampaign(...args),
      updateMany: (...args: unknown[]) => updateManyCampaign(...args),
    },
    communicationRecipient: {
      findMany: (...args: unknown[]) => findManyRecipient(...args),
      count: (...args: unknown[]) => countRecipient(...args),
      update: (...args: unknown[]) => updateRecipient(...args),
    },
    organization: {
      findUnique: (...args: unknown[]) => findUniqueOrganization(...args),
    },
    orgSettings: {
      findUnique: (...args: unknown[]) => findUniqueOrgSettings(...args),
    },
    organizationWhatsAppSettings: {
      findUnique: (...args: unknown[]) => findUniqueWhatsAppSettings(...args),
    },
    attachment: {
      findMany: (...args: unknown[]) => findManyAttachment(...args),
    },
    mobileDeviceToken: {
      findMany: (...args: unknown[]) => findManyDeviceToken(...args),
    },
    communicationLog: {
      create: (...args: unknown[]) => createCommunicationLog(...args),
    },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));
vi.mock("@/lib/member-timeline", () => ({ createMemberTimelineEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/mail", () => ({ sendEmail: vi.fn().mockResolvedValue({ sent: true, skipped: false }) }));
vi.mock("@/lib/push", () => ({ sendPushToTokens: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }) }));
vi.mock("@/lib/sms-service", () => ({
  sendMemberSms: vi.fn().mockResolvedValue({ status: "SENT" }),
  applySmsTemplateTokens: (body: string) => body,
}));
vi.mock("@/lib/storage", () => ({ getSignedObjectUrl: vi.fn().mockResolvedValue("https://signed.example/file") }));
vi.mock("@/lib/env", () => ({ getMobileAppWebBaseUrl: () => "https://app.getunestra.com" }));

const whatsAppChannelSend = vi.fn();
vi.mock("@/lib/communications/channel", () => ({
  WhatsAppChannel: { key: "WHATSAPP", send: (...args: unknown[]) => whatsAppChannelSend(...args) },
}));

const getWhatsAppEntitlement = vi.fn();
vi.mock("@/lib/whatsapp/entitlement", () => ({ getWhatsAppEntitlement: (...args: unknown[]) => getWhatsAppEntitlement(...args) }));

// This suite tests WhatsApp send behavior, not the subscription gate —
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

import { sendCommunicationCampaign } from "@/lib/communication-campaigns";

function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "campaign-1",
    organizationId: "org-a",
    title: "Announcement",
    subject: "Subject",
    body: "Body",
    channel: "INTERNAL_LOG_ONLY",
    status: "READY",
    pushEnabled: false,
    deepLink: null,
    whatsappEnabled: true,
    whatsappTemplateKey: "announcement_notice",
    whatsappTemplateVariables: { organizationName: "ThrivePath Foundation" },
    ...overrides,
  };
}

function makeRecipient(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    campaignId: "campaign-1",
    memberId: `member-${id}`,
    email: null,
    phone: null,
    member: { whatsappPhoneNumber: "+15551234567" },
    ...overrides,
  };
}

describe("sendCommunicationCampaign — WhatsApp", () => {
  beforeEach(() => {
    findFirstCampaign.mockReset();
    findManyRecipient.mockReset();
    countRecipient.mockReset();
    countRecipient.mockResolvedValue(0);
    updateCampaign.mockClear();
    updateManyCampaign.mockClear();
    updateManyCampaign.mockResolvedValue({ count: 1 });
    updateRecipient.mockClear();
    createCommunicationLog.mockClear();
    createAuditEvent.mockClear();
    findUniqueOrgSettings.mockClear();
    findUniqueOrgSettings.mockResolvedValue({ timezone: "America/New_York" });
    findUniqueWhatsAppSettings.mockClear();
    findUniqueWhatsAppSettings.mockResolvedValue({ quietHoursStartHour: 21, quietHoursEndHour: 8 });
    whatsAppChannelSend.mockReset();
    whatsAppChannelSend.mockResolvedValue({ status: "SENT", providerMessageId: "SM1" });
    getWhatsAppEntitlement.mockReset();
    getWhatsAppEntitlement.mockResolvedValue({ allowed: true, remaining: 100, limit: 500 });
  });

  it("blocks and marks the campaign FAILED when the org's WhatsApp entitlement has lapsed since creation", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign());
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: false, reason: "Your organization does not have the WhatsApp add-on enabled.", remaining: 0, limit: 0 });

    await expect(sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" })).rejects.toThrow(
      /WhatsApp add-on/
    );

    expect(updateCampaign).toHaveBeenCalledWith({ where: { id: "campaign-1" }, data: { status: "FAILED" } });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "communication_campaign.blocked", metadata: { reason: "whatsapp_entitlement_required" } })
    );
    expect(findManyRecipient).not.toHaveBeenCalled();
  });

  it("sends via WhatsAppChannel for a recipient with a whatsappPhoneNumber, using the campaign's template", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T15:00:00Z")); // 10am America/New_York — outside quiet hours
    try {
      findFirstCampaign.mockResolvedValueOnce(makeCampaign());
      findManyRecipient.mockResolvedValueOnce([makeRecipient("r1")]);
      countRecipient.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

      expect(whatsAppChannelSend).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-a",
          memberId: "member-r1",
          phone: "+15551234567",
          templateKey: "announcement_notice",
          templateVariables: { organizationName: "ThrivePath Foundation" },
          campaignId: "campaign-1",
        })
      );
      expect(updateRecipient).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ whatsappDeliveryStatus: "SENT" }) })
      );
      expect(createCommunicationLog).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ communicationType: "WHATSAPP", message: "announcement_notice" }) })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("never calls WhatsAppChannel for a recipient with no whatsappPhoneNumber", async () => {
    findFirstCampaign.mockResolvedValueOnce(makeCampaign());
    findManyRecipient.mockResolvedValueOnce([makeRecipient("r1", { member: { whatsappPhoneNumber: null } })]);
    countRecipient.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

    expect(whatsAppChannelSend).not.toHaveBeenCalled();
  });

  it("records a failed WhatsApp send's error on the recipient row without failing the whole batch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T15:00:00Z")); // 10am America/New_York — outside quiet hours
    try {
      findFirstCampaign.mockResolvedValueOnce(makeCampaign());
      findManyRecipient.mockResolvedValueOnce([makeRecipient("r1")]);
      whatsAppChannelSend.mockResolvedValueOnce({ status: "FAILED", errorMessage: "Member opted out of WhatsApp." });
      countRecipient.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(1);

      await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

      expect(updateRecipient).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ whatsappDeliveryStatus: "FAILED", whatsappError: "Member opted out of WhatsApp." }) })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a recipient PENDING (never calls WhatsAppChannel) during the org's configured quiet hours", async () => {
    // 2026-01-15T02:00:00 UTC = 9pm America/New_York the prior day — inside the default 21-8 window.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T02:00:00Z"));
    try {
      findFirstCampaign.mockResolvedValueOnce(makeCampaign());
      findManyRecipient.mockResolvedValueOnce([makeRecipient("r1")]);
      countRecipient.mockResolvedValueOnce(1); // still PENDING after the batch

      const result = await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

      expect(whatsAppChannelSend).not.toHaveBeenCalled();
      expect(updateRecipient).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deliveryStatus: "PENDING", whatsappDeliveryStatus: undefined }) })
      );
      expect(result.complete).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends normally outside quiet hours", async () => {
    // 2026-01-15T15:00:00 UTC = 10am America/New_York — outside the 21-8 window.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T15:00:00Z"));
    try {
      findFirstCampaign.mockResolvedValueOnce(makeCampaign());
      findManyRecipient.mockResolvedValueOnce([makeRecipient("r1")]);
      countRecipient.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      await sendCommunicationCampaign({ organizationId: "org-a", campaignId: "campaign-1" });

      expect(whatsAppChannelSend).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
