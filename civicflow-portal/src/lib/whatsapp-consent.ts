import type { WhatsAppOptInSource } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { WHATSAPP_CONSENT_VERSION } from "@/lib/whatsapp-consent-text";

export { WHATSAPP_CONSENT_TEXT, WHATSAPP_CONSENT_VERSION, formatWhatsAppOptInSource } from "@/lib/whatsapp-consent-text";

interface RecordWhatsAppOptInInput {
  organizationId: string;
  memberId: string;
  phone: string;
  ip: string;
  source: WhatsAppOptInSource;
  actorUserId?: string | null;
}

/**
 * Records explicit WhatsApp consent. This is the only place a self-service
 * or admin-assisted opt-in should write OrgMember.whatsapp* consent fields —
 * mirrors sms-consent.ts's recordSmsOptIn(). The inbound-webhook START/STOP
 * path (src/app/api/webhooks/twilio/whatsapp/inbound/route.ts) writes these
 * fields directly for the same reason the SMS webhook does: it's a distinct,
 * already-audited entry point, not a bypass of this one.
 */
export async function recordWhatsAppOptIn(input: RecordWhatsAppOptInInput) {
  const now = new Date();

  const member = await prisma.orgMember.update({
    where: { id: input.memberId },
    data: {
      whatsappPhoneNumber: input.phone,
      whatsappEnabled: true,
      whatsappOptInStatus: "OPTED_IN",
      whatsappOptInSource: input.source,
      whatsappOptedInAt: now,
      whatsappOptedOutAt: null,
      whatsappConsentTextVersion: WHATSAPP_CONSENT_VERSION,
      whatsappLastConfirmedAt: now,
      whatsappOptInIP: input.ip,
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    action: "whatsapp_consent.opt_in",
    entityType: "OrgMember",
    entityId: input.memberId,
    ipAddress: input.ip,
    metadata: { phone: input.phone, source: input.source, consentVersion: WHATSAPP_CONSENT_VERSION },
  });

  return member;
}

interface RecordWhatsAppOptOutInput {
  organizationId: string;
  memberId: string;
  actorUserId?: string | null;
  source: "self_service" | "whatsapp_reply";
  ip?: string | null;
}

/** Withdraws WhatsApp consent (self-service, or an inbound STOP-family reply). */
export async function recordWhatsAppOptOut(input: RecordWhatsAppOptOutInput) {
  const now = new Date();

  const member = await prisma.orgMember.update({
    where: { id: input.memberId },
    data: {
      whatsappEnabled: false,
      whatsappOptInStatus: "OPTED_OUT",
      whatsappOptedOutAt: now,
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    action: "whatsapp_consent.opt_out",
    entityType: "OrgMember",
    entityId: input.memberId,
    ipAddress: input.ip ?? null,
    metadata: { source: input.source },
  });

  return member;
}
