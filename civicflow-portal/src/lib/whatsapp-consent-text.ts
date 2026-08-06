import type { WhatsAppOptInSource } from "@prisma/client";

/**
 * Pure constants/formatters with no server-only imports, so client
 * components (Notification Settings) can import this directly without
 * pulling in prisma. Server-side consent logic lives in
 * src/lib/whatsapp-consent.ts, which also imports from here so the copy
 * never drifts between the two. Mirrors sms-consent-text.ts.
 */

/**
 * Bump whenever WHATSAPP_CONSENT_TEXT changes so the audit trail always
 * shows exactly which version of the consent language a member agreed to.
 */
export const WHATSAPP_CONSENT_VERSION = "2026-08-06.1";

export const WHATSAPP_CONSENT_TEXT =
  "I agree that organizations I belong to on Unestra may send me WhatsApp messages for announcements, " +
  "meeting and event reminders, dues and payment notices, and volunteer opportunities. Message frequency " +
  "varies. Message and data rates may apply. Reply STOP at any time to unsubscribe. This consent is " +
  "separate from SMS or email consent and does not affect those preferences. See our Privacy Policy for " +
  "details. Consent is not a condition of membership.";

const SOURCE_LABELS: Record<WhatsAppOptInSource, string> = {
  SELF_SERVICE: "Self-Service",
  ADMIN_ASSISTED: "Admin-Assisted",
  WHATSAPP_REPLY: "WhatsApp Reply",
  INVITE_ONBOARDING: "Invite Onboarding",
};

export function formatWhatsAppOptInSource(source: WhatsAppOptInSource | null | undefined): string | null {
  return source ? SOURCE_LABELS[source] : null;
}
