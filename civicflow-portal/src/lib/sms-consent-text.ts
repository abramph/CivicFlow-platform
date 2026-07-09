import type { SmsOptInMethod } from "@prisma/client";

/**
 * Pure constants/formatters with no server-only imports, so client
 * components (the consent checkbox on AcceptInviteForm, the Notification
 * Settings form, /sms-opt-in) can import this directly without pulling in
 * prisma. Server-side consent logic lives in src/lib/sms-consent.ts, which
 * also imports from here so the copy never drifts between the two.
 */

/**
 * Bump whenever SMS_CONSENT_TEXT changes so the audit trail always shows
 * exactly which version of the consent language a member agreed to.
 */
export const SMS_CONSENT_VERSION = "2026-07-08.1";

export const SMS_CONSENT_TEXT =
  "I agree to receive SMS messages from CivicFlow and organizations that I belong to for account " +
  "verification, password resets, payment confirmations, membership renewals, event reminders, " +
  "volunteer notifications, and organization announcements. Message and data rates may apply. Reply " +
  "STOP to opt out and HELP for assistance. Consent is not a condition of purchase.";

const METHOD_LABELS: Record<SmsOptInMethod, string> = {
  WEBSITE_REGISTRATION: "Website Registration",
  PROFILE_SETTINGS: "Profile Settings",
  QR_CODE: "QR Code",
};

export function formatSmsOptInMethod(method: SmsOptInMethod | null | undefined): string | null {
  return method ? METHOD_LABELS[method] : null;
}
