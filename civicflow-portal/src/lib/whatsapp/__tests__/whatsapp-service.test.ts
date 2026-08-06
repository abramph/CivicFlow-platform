import { beforeEach, describe, expect, it, vi } from "vitest";

const createWhatsAppMessage = vi.fn();
const updateWhatsAppMessage = vi.fn();
const findUniqueOrgMember = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsAppMessage: {
      create: (...args: unknown[]) => createWhatsAppMessage(...args),
      update: (...args: unknown[]) => updateWhatsAppMessage(...args),
    },
    orgMember: {
      findUnique: (...args: unknown[]) => findUniqueOrgMember(...args),
    },
  },
}));

const isWhatsAppConfigured = vi.fn();
const sendWhatsAppMessage = vi.fn();
vi.mock("@/lib/whatsapp/send", () => ({
  isWhatsAppConfigured: () => isWhatsAppConfigured(),
  sendWhatsAppMessage: (...args: unknown[]) => sendWhatsAppMessage(...args),
}));

const getWhatsAppEntitlement = vi.fn();
const recordWhatsAppUsage = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/whatsapp/entitlement", () => ({
  getWhatsAppEntitlement: (...args: unknown[]) => getWhatsAppEntitlement(...args),
  recordWhatsAppUsage: (...args: unknown[]) => recordWhatsAppUsage(...args),
}));

const getActiveTemplate = vi.fn();
const validateTemplateVariables = vi.fn();
vi.mock("@/lib/whatsapp/templates", () => ({
  getActiveTemplate: (...args: unknown[]) => getActiveTemplate(...args),
  validateTemplateVariables: (...args: unknown[]) => validateTemplateVariables(...args),
}));

import { sendMemberWhatsApp } from "@/lib/whatsapp/whatsapp-service";

function baseParams(overrides: Partial<Parameters<typeof sendMemberWhatsApp>[0]> = {}) {
  return {
    organizationId: "org-a",
    memberId: "member-1",
    phone: "+15551234567",
    body: "Test message",
    ...overrides,
  };
}

const OPTED_IN_MEMBER = { whatsappEnabled: true, whatsappOptedOutAt: null, whatsappOptInStatus: "OPTED_IN" };

describe("sendMemberWhatsApp", () => {
  beforeEach(() => {
    createWhatsAppMessage.mockReset();
    updateWhatsAppMessage.mockReset();
    findUniqueOrgMember.mockReset();
    isWhatsAppConfigured.mockReset();
    sendWhatsAppMessage.mockReset();
    getWhatsAppEntitlement.mockReset();
    getActiveTemplate.mockReset();
    validateTemplateVariables.mockReset();
    recordWhatsAppUsage.mockClear();
    createWhatsAppMessage.mockResolvedValue({ id: "wa-1", status: "FAILED" });
  });

  it("rejects a call with both templateKey and body", async () => {
    const result = await sendMemberWhatsApp(baseParams({ templateKey: "meeting_reminder", body: "hi" }));
    expect(result.status).toBe("FAILED");
    expect(isWhatsAppConfigured).not.toHaveBeenCalled();
  });

  it("rejects a call with neither templateKey nor body", async () => {
    const result = await sendMemberWhatsApp({ organizationId: "org-a", phone: "+15551234567" });
    expect(result.status).toBe("FAILED");
    expect(isWhatsAppConfigured).not.toHaveBeenCalled();
  });

  it("fails gracefully with a clear message when WhatsApp is not configured, never calling Twilio", async () => {
    isWhatsAppConfigured.mockReturnValueOnce(false);
    createWhatsAppMessage.mockResolvedValueOnce({
      id: "wa-1",
      status: "FAILED",
      errorMessage: "WhatsApp delivery is not configured.",
    });

    const result = await sendMemberWhatsApp(baseParams());

    expect(result.status).toBe("FAILED");
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(getWhatsAppEntitlement).not.toHaveBeenCalled();
  });

  it("fails gracefully when the organization has no WhatsApp entitlement, never calling Twilio", async () => {
    isWhatsAppConfigured.mockReturnValueOnce(true);
    getWhatsAppEntitlement.mockResolvedValueOnce({
      allowed: false,
      reason: "Your organization does not have the WhatsApp add-on enabled.",
      remaining: 0,
      limit: 0,
    });

    const result = await sendMemberWhatsApp(baseParams());

    expect(result.status).toBe("FAILED");
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("does not call Twilio when the member has never opted in to WhatsApp", async () => {
    isWhatsAppConfigured.mockReturnValueOnce(true);
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 500 });
    findUniqueOrgMember.mockResolvedValueOnce({
      whatsappEnabled: false,
      whatsappOptedOutAt: null,
      whatsappOptInStatus: "NOT_STARTED",
    });

    const result = await sendMemberWhatsApp(baseParams());

    expect(result.status).toBe("FAILED");
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("does not call Twilio when the member explicitly opted out, even though whatsappEnabled looks true", async () => {
    isWhatsAppConfigured.mockReturnValueOnce(true);
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 500 });
    findUniqueOrgMember.mockResolvedValueOnce({
      whatsappEnabled: true,
      whatsappOptedOutAt: new Date(),
      whatsappOptInStatus: "OPTED_IN",
    });

    const result = await sendMemberWhatsApp(baseParams());

    expect(result.status).toBe("FAILED");
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("does not call Twilio when the member has WhatsApp notifications toggled off, even though opted in", async () => {
    isWhatsAppConfigured.mockReturnValueOnce(true);
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 500 });
    findUniqueOrgMember.mockResolvedValueOnce({
      whatsappEnabled: false,
      whatsappOptedOutAt: null,
      whatsappOptInStatus: "OPTED_IN",
    });

    const result = await sendMemberWhatsApp(baseParams());

    expect(result.status).toBe("FAILED");
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("required=true bypasses the whatsappEnabled preference toggle but still requires real opt-in", async () => {
    isWhatsAppConfigured.mockReturnValueOnce(true);
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 500 });
    findUniqueOrgMember.mockResolvedValueOnce({
      whatsappEnabled: false,
      whatsappOptedOutAt: null,
      whatsappOptInStatus: "OPTED_IN",
    });
    createWhatsAppMessage.mockResolvedValueOnce({ id: "wa-1", status: "QUEUED" });
    sendWhatsAppMessage.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM1" });
    updateWhatsAppMessage.mockResolvedValueOnce({ id: "wa-1", status: "SENT" });

    const result = await sendMemberWhatsApp(baseParams({ required: true }));

    expect(sendWhatsAppMessage).toHaveBeenCalled();
    expect(result.status).toBe("SENT");
    expect(recordWhatsAppUsage).toHaveBeenCalledWith("org-a");
  });

  it("required=true does NOT bypass a hard opt-out", async () => {
    isWhatsAppConfigured.mockReturnValueOnce(true);
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 500 });
    findUniqueOrgMember.mockResolvedValueOnce({
      whatsappEnabled: true,
      whatsappOptedOutAt: new Date(),
      whatsappOptInStatus: "OPTED_IN",
    });

    const result = await sendMemberWhatsApp(baseParams({ required: true }));

    expect(result.status).toBe("FAILED");
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("rejects an invalid phone number before calling Twilio", async () => {
    isWhatsAppConfigured.mockReturnValueOnce(true);
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 500 });

    const result = await sendMemberWhatsApp(baseParams({ phone: "not-a-phone", memberId: null }));

    expect(result.status).toBe("FAILED");
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("sends a freeform body successfully and records usage", async () => {
    isWhatsAppConfigured.mockReturnValueOnce(true);
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 500 });
    findUniqueOrgMember.mockResolvedValueOnce(OPTED_IN_MEMBER);
    createWhatsAppMessage.mockResolvedValueOnce({ id: "wa-1", status: "QUEUED" });
    sendWhatsAppMessage.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM1" });
    updateWhatsAppMessage.mockResolvedValueOnce({ id: "wa-1", status: "SENT" });

    const result = await sendMemberWhatsApp(baseParams());

    expect(result.status).toBe("SENT");
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+15551234567", body: "Test message", contentSid: undefined })
    );
    expect(recordWhatsAppUsage).toHaveBeenCalledWith("org-a");
    expect(getActiveTemplate).not.toHaveBeenCalled();
  });

  it("denies a send for a template that isn't active/approved, without calling Twilio", async () => {
    isWhatsAppConfigured.mockReturnValueOnce(true);
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 500 });
    findUniqueOrgMember.mockResolvedValueOnce(OPTED_IN_MEMBER);
    getActiveTemplate.mockResolvedValueOnce(null);

    const result = await sendMemberWhatsApp(baseParams({ templateKey: "meeting_reminder", body: undefined }));

    expect(result.status).toBe("FAILED");
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("denies a send for a template with no synced Content SID", async () => {
    isWhatsAppConfigured.mockReturnValueOnce(true);
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 500 });
    findUniqueOrgMember.mockResolvedValueOnce(OPTED_IN_MEMBER);
    getActiveTemplate.mockResolvedValueOnce({ key: "meeting_reminder", twilioContentSid: null, category: "UTILITY" });

    const result = await sendMemberWhatsApp(baseParams({ templateKey: "meeting_reminder", body: undefined }));

    expect(result.status).toBe("FAILED");
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("denies a send when template variable validation fails", async () => {
    isWhatsAppConfigured.mockReturnValueOnce(true);
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 500 });
    findUniqueOrgMember.mockResolvedValueOnce(OPTED_IN_MEMBER);
    getActiveTemplate.mockResolvedValueOnce({ key: "meeting_reminder", twilioContentSid: "HXtest", category: "UTILITY" });
    validateTemplateVariables.mockReturnValueOnce({ valid: false, reason: 'Missing required template variable "date".' });

    const result = await sendMemberWhatsApp(
      baseParams({ templateKey: "meeting_reminder", body: undefined, templateVariables: {} })
    );

    expect(result.status).toBe("FAILED");
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("sends an approved template with validated variables, storing no literal body", async () => {
    isWhatsAppConfigured.mockReturnValueOnce(true);
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 500 });
    findUniqueOrgMember.mockResolvedValueOnce(OPTED_IN_MEMBER);
    getActiveTemplate.mockResolvedValueOnce({
      key: "meeting_reminder",
      twilioContentSid: "HXtest",
      category: "UTILITY",
    });
    validateTemplateVariables.mockReturnValueOnce({ valid: true, variables: { date: "Aug 10" } });
    createWhatsAppMessage.mockResolvedValueOnce({ id: "wa-1", status: "QUEUED" });
    sendWhatsAppMessage.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM2" });
    updateWhatsAppMessage.mockResolvedValueOnce({ id: "wa-1", status: "SENT" });

    const result = await sendMemberWhatsApp(
      baseParams({ templateKey: "meeting_reminder", body: undefined, templateVariables: { date: "Aug 10" } })
    );

    expect(result.status).toBe("SENT");
    expect(createWhatsAppMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ body: null, templateKey: "meeting_reminder", category: "UTILITY" }) })
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: "HXtest", contentVariables: { date: "Aug 10" } })
    );
  });

  it("marks FAILED and does not record usage when Twilio itself errors", async () => {
    isWhatsAppConfigured.mockReturnValueOnce(true);
    getWhatsAppEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 500, limit: 500 });
    findUniqueOrgMember.mockResolvedValueOnce(OPTED_IN_MEMBER);
    createWhatsAppMessage.mockResolvedValueOnce({ id: "wa-1", status: "QUEUED" });
    sendWhatsAppMessage.mockResolvedValueOnce({ sent: false, skipped: false, to: "+15551234567", reason: "Twilio request failed (500)" });
    updateWhatsAppMessage.mockResolvedValueOnce({ id: "wa-1", status: "FAILED", errorMessage: "Twilio request failed (500)" });

    const result = await sendMemberWhatsApp(baseParams());

    expect(result.status).toBe("FAILED");
    expect(recordWhatsAppUsage).not.toHaveBeenCalled();
  });
});
