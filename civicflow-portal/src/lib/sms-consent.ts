import type { SmsOptInMethod } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { SMS_CONSENT_VERSION } from "@/lib/sms-consent-text";

export { SMS_CONSENT_TEXT, SMS_CONSENT_VERSION, formatSmsOptInMethod } from "@/lib/sms-consent-text";

interface RecordSmsOptInInput {
  organizationId: string;
  memberId: string;
  phone: string;
  ip: string;
  method: SmsOptInMethod;
  actorUserId?: string | null;
}

/**
 * Records explicit, verifiable SMS consent. This is the only place OrgMember
 * consent fields should be written from — every entry point (accept-invite,
 * Notification Settings, the /sms-opt-in landing page) must funnel through
 * here so the audit trail is complete and consistent.
 */
export async function recordSmsOptIn(input: RecordSmsOptInInput) {
  const now = new Date();

  const member = await prisma.orgMember.update({
    where: { id: input.memberId },
    data: {
      phone: input.phone,
      smsOptIn: true,
      smsOptInDate: now,
      smsOptInIP: input.ip,
      smsOptInMethod: input.method,
      smsConsentVersion: SMS_CONSENT_VERSION,
      smsOptOutDate: null,
      commsSmsEnabled: true,
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    action: "sms_consent.opt_in",
    entityType: "OrgMember",
    entityId: input.memberId,
    ipAddress: input.ip,
    metadata: {
      phone: input.phone,
      method: input.method,
      consentVersion: SMS_CONSENT_VERSION,
    },
  });

  return member;
}

interface RecordSmsOptOutInput {
  organizationId: string;
  memberId: string;
  actorUserId?: string | null;
  source: "self_service" | "sms_reply";
  ip?: string | null;
}

/** Withdraws SMS consent (self-service, or an inbound STOP reply). */
export async function recordSmsOptOut(input: RecordSmsOptOutInput) {
  const now = new Date();

  const member = await prisma.orgMember.update({
    where: { id: input.memberId },
    data: {
      smsOptIn: false,
      smsOptOutDate: now,
      commsSmsEnabled: false,
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    action: "sms_consent.opt_out",
    entityType: "OrgMember",
    entityId: input.memberId,
    ipAddress: input.ip ?? null,
    metadata: { source: input.source },
  });

  return member;
}
