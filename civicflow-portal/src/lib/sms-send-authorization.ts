import { prisma } from "@/lib/prisma";
import { normalizeToE164 } from "@/lib/phone";
import { getSmsEntitlement } from "@/lib/sms-entitlement";
import { isSmsConfigured } from "@/lib/sms";

export interface SmsSendAuthorizationInput {
  organizationId: string;
  memberId?: string | null;
  phone: string;
  /**
   * Bypasses ONLY the member's commsSmsEnabled preference toggle (legally
   * required notices). Never bypasses smsOptIn or smsOptedOutAt — those are
   * consent/compliance gates (TCPA), not preferences. Retries must pass
   * false: the original send's "required" flag is not persisted on the
   * SmsMessage row, so the retry path fails closed to the stricter rule.
   */
  required?: boolean;
  /**
   * When true, a missing/null memberId is itself a denial. Set by the retry
   * path: a queued row whose member was deleted has memberId nulled by the
   * FK's onDelete: SetNull, which makes consent unverifiable — so the retry
   * must be blocked rather than sent "member-less". The initial send path
   * leaves this false because it has legitimate member-less callers.
   */
  requireMember?: boolean;
}

export type SmsSendAuthorization =
  | { allowed: true; normalizedPhone: string }
  | { allowed: false; reason: string };

/**
 * The single canonical "may this SMS be sent, right now?" decision, applied
 * immediately before every Twilio call — initial campaign sends
 * (sms-service.ts sendMemberSms), manual admin Retry and the cron queue
 * sweep (sms-queue.ts attemptSmsMessageResend). Everything is re-resolved
 * fresh from the database at the moment of sending; nothing is trusted from
 * when the message was first queued:
 *
 *   1. platform SMS configuration (isSmsConfigured — credentials + sender);
 *   2. organization entitlement (getSmsEntitlement — platform org-messaging
 *      switch, smsAddOnActive, per-org suspension, subscription or
 *      billing-exempt eligibility, monthly quota policy);
 *   3. E.164 normalization of the destination;
 *   4. recipient identity WITHIN the organization (tenant-scoped lookup —
 *      a memberId from another organization, or a member since removed,
 *      is a denial, never a silent pass);
 *   5. consent state: smsOptIn (hard), smsOptedOutAt/STOP (hard, no
 *      exceptions), commsSmsEnabled (preference — bypassable only via
 *      `required`).
 *
 * Denials return the exact human-readable reasons the rest of the SMS stack
 * already records into SmsMessage.errorMessage, so callers keep the existing
 * auditable status/reason convention. This module must remain the ONLY
 * implementation of these rules — do not add competing checks at call sites.
 */
export async function authorizeSmsSend(input: SmsSendAuthorizationInput): Promise<SmsSendAuthorization> {
  const { organizationId, memberId, phone, required, requireMember } = input;

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

  if (!memberId && requireMember) {
    return { allowed: false, reason: "Recipient consent cannot be verified for this message." };
  }

  if (memberId) {
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
  }

  return { allowed: true, normalizedPhone };
}
