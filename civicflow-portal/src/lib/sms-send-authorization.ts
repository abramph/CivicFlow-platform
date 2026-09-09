import { prisma } from "@/lib/prisma";
import { normalizeToE164 } from "@/lib/phone";
import { getSmsEntitlement } from "@/lib/sms-entitlement";
import { isSmsConfigured } from "@/lib/sms";

export interface SmsSendAuthorizationInput {
  organizationId: string;
  /**
   * The tenant-scoped OrgMember the message is addressed to. REQUIRED for
   * every organization message — null fails closed. Null is representable
   * (rather than the field being non-nullable) only because historical
   * SmsMessage rows can carry a null memberId after their member was deleted
   * (FK onDelete: SetNull); the retry path passes that null through and gets
   * the deny it must get.
   */
  memberId: string | null;
  phone: string;
  /**
   * Bypasses ONLY the member's commsSmsEnabled preference toggle (legally
   * required notices). Never bypasses smsOptIn or smsOptedOutAt — those are
   * consent/compliance gates (TCPA), not preferences. Retries must pass
   * false: the original send's "required" flag is not persisted on the
   * SmsMessage row, so the retry path fails closed to the stricter rule.
   */
  required?: boolean;
}

export type SmsSendAuthorization =
  | { allowed: true; normalizedPhone: string }
  | { allowed: false; reason: string };

/**
 * The single canonical "may this ORGANIZATION message be sent, right now?"
 * decision, applied immediately before every organization-message Twilio
 * call — initial campaign sends (sms-service.ts sendMemberSms) and manual
 * admin Retry / the cron queue sweep (sms-queue.ts attemptSmsMessageResend).
 * Everything is re-resolved fresh from the database at the moment of
 * sending; nothing is trusted from when the message was first queued:
 *
 *   1. platform SMS configuration (isSmsConfigured — credentials + sender);
 *   2. organization entitlement (getSmsEntitlement — platform org-messaging
 *      switch, smsAddOnActive, per-org suspension, subscription or
 *      billing-exempt eligibility, quota policy pre-check; the
 *      concurrency-safe quota claim itself is reserveSmsAllowance, taken by
 *      the callers after this authorization passes);
 *   3. E.164 normalization of the destination;
 *   4. recipient identity WITHIN the organization: a null memberId, a
 *      memberId from another organization, or a member since removed is a
 *      denial — never a silent pass. Consent is unverifiable without a
 *      tenant-scoped member row.
 *   5. consent state: smsOptIn (hard), smsOptedOutAt/STOP (hard, no
 *      exceptions), commsSmsEnabled (preference — bypassable only via
 *      `required`).
 *
 * SCOPE, deliberately: this guards ORGANIZATION/member messaging — the SMS
 * add-on surface. MFA sign-in codes, login verification, and user-requested
 * phone-verification texts are transactional platform messages sent through
 * the lower-level sendSms() (lib/sms.ts), which enforces the platform-wide
 * switches (enabled/maintenance/paused/test-mode) but sits outside the
 * organization add-on entitlement and this member-consent model — the
 * recipient there is the authenticating user's own just-provided number,
 * not an organization roster entry.
 *
 * Denials return the exact human-readable reasons the rest of the SMS stack
 * already records into SmsMessage.errorMessage, so callers keep the existing
 * auditable status/reason convention. This module must remain the ONLY
 * implementation of these rules — do not add competing checks at call sites.
 */
export async function authorizeSmsSend(input: SmsSendAuthorizationInput): Promise<SmsSendAuthorization> {
  const { organizationId, memberId, phone, required } = input;

  if (!(await isSmsConfigured())) {
    return { allowed: false, reason: "SMS delivery is not configured." };
  }

  const entitlement = await getSmsEntitlement(organizationId);
  if (!entitlement.allowed) {
    return { allowed: false, reason: entitlement.reason ?? "SMS is not enabled for this organization." };
  }

  const normalizedPhone = normalizeToE164(phone);
  if (!normalizedPhone) {
    return { allowed: false, reason: "Invalid phone number." };
  }

  if (!memberId) {
    return { allowed: false, reason: "Recipient consent cannot be verified for this message." };
  }

  // Tenant-scoped on purpose: findFirst({ id, organizationId }), never a
  // bare findUnique({ id }). A member row belonging to another tenant must
  // not be readable here — neither to leak its consent state nor to let an
  // old queued row follow a recipient who was moved/removed.
  const member = await prisma.orgMember.findFirst({
    where: { id: memberId, organizationId },
    select: { commsSmsEnabled: true, smsOptedOutAt: true, smsOptIn: true },
  });
  if (!member) {
    return { allowed: false, reason: "Recipient is no longer a member of this organization." };
  }
  if (!member.smsOptIn) {
    return { allowed: false, reason: "Member has not opted in to SMS." };
  }
  if (member.smsOptedOutAt) {
    return { allowed: false, reason: "Member opted out of SMS." };
  }
  if (!required && !member.commsSmsEnabled) {
    return { allowed: false, reason: "Member has SMS notifications turned off." };
  }

  return { allowed: true, normalizedPhone };
}
