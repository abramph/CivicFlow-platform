import { beforeEach, describe, expect, it, vi } from "vitest";

const updateOrgMember = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: {
      update: (...args: unknown[]) => updateOrgMember(...args),
    },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import { recordWhatsAppOptIn, recordWhatsAppOptOut, WHATSAPP_CONSENT_VERSION } from "@/lib/whatsapp-consent";

describe("recordWhatsAppOptIn", () => {
  beforeEach(() => {
    updateOrgMember.mockReset();
    updateOrgMember.mockResolvedValue({ id: "member-1" });
    createAuditEvent.mockClear();
  });

  it("writes all consent fields, including the current consent text version, and clears any prior opt-out", async () => {
    await recordWhatsAppOptIn({
      organizationId: "org-a",
      memberId: "member-1",
      phone: "+15551234567",
      ip: "203.0.113.5",
      source: "SELF_SERVICE",
      actorUserId: "user-1",
    });

    expect(updateOrgMember).toHaveBeenCalledWith({
      where: { id: "member-1" },
      data: expect.objectContaining({
        whatsappPhoneNumber: "+15551234567",
        whatsappEnabled: true,
        whatsappOptInStatus: "OPTED_IN",
        whatsappOptInSource: "SELF_SERVICE",
        whatsappOptedOutAt: null,
        whatsappConsentTextVersion: WHATSAPP_CONSENT_VERSION,
        whatsappOptInIP: "203.0.113.5",
      }),
    });
  });

  it("writes an audit event capturing the phone, source, and consent version — never the raw message content", async () => {
    await recordWhatsAppOptIn({
      organizationId: "org-a",
      memberId: "member-1",
      phone: "+15551234567",
      ip: "203.0.113.5",
      source: "SELF_SERVICE",
      actorUserId: "user-1",
    });

    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-a",
        action: "whatsapp_consent.opt_in",
        entityType: "OrgMember",
        entityId: "member-1",
        ipAddress: "203.0.113.5",
        metadata: { phone: "+15551234567", source: "SELF_SERVICE", consentVersion: WHATSAPP_CONSENT_VERSION },
      })
    );
  });
});

describe("recordWhatsAppOptOut", () => {
  beforeEach(() => {
    updateOrgMember.mockReset();
    updateOrgMember.mockResolvedValue({ id: "member-1" });
    createAuditEvent.mockClear();
  });

  it("sets whatsappOptedOutAt and flips whatsappOptInStatus/whatsappEnabled off", async () => {
    await recordWhatsAppOptOut({
      organizationId: "org-a",
      memberId: "member-1",
      actorUserId: "user-1",
      source: "self_service",
      ip: "203.0.113.5",
    });

    expect(updateOrgMember).toHaveBeenCalledWith({
      where: { id: "member-1" },
      data: expect.objectContaining({
        whatsappEnabled: false,
        whatsappOptInStatus: "OPTED_OUT",
        whatsappOptedOutAt: expect.any(Date),
      }),
    });
  });

  it("records the opt-out source in the audit event", async () => {
    await recordWhatsAppOptOut({ organizationId: "org-a", memberId: "member-1", source: "whatsapp_reply" });

    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "whatsapp_consent.opt_out", metadata: { source: "whatsapp_reply" } })
    );
  });
});
