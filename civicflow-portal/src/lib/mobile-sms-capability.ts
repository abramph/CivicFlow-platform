import { getSmsEntitlement, type SmsEntitlement, type SmsEntitlementReasonCode } from "@/lib/sms-entitlement";
import { getSmsPlatformStatus, type SmsPlatformUnavailableCode } from "@/lib/sms-operational-status";

/**
 * The mobile app's SMS-availability contract. It is a deliberately NARROW
 * projection of the server's COMPLETE send-time gate — the platform-operational
 * switches (src/lib/sms-operational-status.ts, shared with sendSms) AND the
 * per-org entitlement (getSmsEntitlement) — so the composer fails closed for
 * every condition that would block an actual send, not just the entitlement
 * subset it used to check.
 *
 * What it deliberately never carries: Stripe price / subscription / product /
 * item ids, Twilio credentials or messaging-service/sender identifiers, the
 * org's phone-number configuration, or any raw billing amount. The client
 * switches on `available` (and `restricted`) only and routes to billing when
 * `billingManagementRequired` is set.
 */
export type SmsCapabilityReasonCode =
  | SmsPlatformUnavailableCode
  | SmsEntitlementReasonCode
  | "RESTRICTED_TEST_MODE";

export interface MobileSmsCapability {
  /** True iff SMS may be offered as a channel right now. */
  available: boolean;
  /**
   * Available, but delivery is restricted to a verified allowlist (Safe Launch
   * Mode). SMS is still selectable — the server enforces the per-recipient
   * allowlist at send time — but the UI must say so truthfully rather than
   * imply unrestricted delivery.
   */
  restricted: boolean;
  /** Stable machine code when unavailable OR restricted; null when fully available. */
  reasonCode: SmsCapabilityReasonCode | null;
  /** Truthful, non-sensitive one-liner to show the admin. Null when fully available. */
  message: string | null;
  /** Remaining messages this period, surfaced ONLY when available. */
  remaining: number | null;
  /** True when the denial is one the org can self-serve resolve via billing. */
  billingManagementRequired: boolean;
}

const ENTITLEMENT_MESSAGE: Record<SmsEntitlementReasonCode, string> = {
  PLATFORM_MESSAGING_DISABLED: "Text messaging is temporarily unavailable. Please try again later.",
  ADD_ON_REQUIRED: "SMS isn't part of your plan yet. Add the SMS add-on in Settings → Billing to text members.",
  SUSPENDED: "SMS messaging is suspended for your organization. Please contact support.",
  BILLING_REQUIRED: "Your subscription isn't active. Update billing in Settings → Billing to send SMS.",
  ALLOWANCE_REACHED: "You've used this month's SMS allowance. It resets at the start of your next billing period.",
};

const PLATFORM_MESSAGE: Record<SmsPlatformUnavailableCode, string> = {
  NOT_CONFIGURED: "Text messaging isn't available right now. Please try again later.",
  PLATFORM_DISABLED: "Text messaging is temporarily unavailable. Please try again later.",
  MAINTENANCE: "SMS is temporarily unavailable for maintenance. Please try again later.",
  OUTBOUND_PAUSED: "SMS sending is paused right now. Please try again later.",
};

const RESTRICTED_MESSAGE =
  "SMS is in limited launch mode — only verified test numbers will receive messages until verification is complete.";

/** Only these two denials are self-serve fixable in the billing portal; a
 *  platform-wide condition, an admin suspension, or a spent allowance is not. */
const BILLING_SELF_SERVE = new Set<SmsEntitlementReasonCode>(["ADD_ON_REQUIRED", "BILLING_REQUIRED"]);

/** Pure mapping of an org entitlement to the capability shape (no platform gate
 *  or restricted overlay — see getMobileSmsCapability for the full decision). */
export function toMobileSmsCapability(entitlement: SmsEntitlement): MobileSmsCapability {
  if (entitlement.allowed) {
    return {
      available: true,
      restricted: false,
      reasonCode: null,
      message: null,
      remaining: entitlement.remaining,
      billingManagementRequired: false,
    };
  }
  const code = entitlement.code ?? "ADD_ON_REQUIRED";
  return {
    available: false,
    restricted: false,
    reasonCode: code,
    message: ENTITLEMENT_MESSAGE[code],
    remaining: null,
    billingManagementRequired: BILLING_SELF_SERVE.has(code),
  };
}

/**
 * The COMPLETE mobile SMS availability decision, fail-closed and in the same
 * order a real send is gated:
 *  1. platform-operational switches (config / enabled / maintenance / paused) —
 *     shared with sendSms; any failure here blocks every org;
 *  2. per-org entitlement (add-on / suspension / subscription / allowance);
 *  3. Safe Launch (test mode) → available but `restricted`, since per-recipient
 *     allowlisting is unknown before audience resolution.
 */
export async function getMobileSmsCapability(organizationId: string): Promise<MobileSmsCapability> {
  const platform = await getSmsPlatformStatus();
  if (!platform.available && platform.unavailableCode) {
    return {
      available: false,
      restricted: false,
      reasonCode: platform.unavailableCode,
      message: PLATFORM_MESSAGE[platform.unavailableCode],
      remaining: null,
      billingManagementRequired: false,
    };
  }

  const capability = toMobileSmsCapability(await getSmsEntitlement(organizationId));
  if (!capability.available) return capability;

  // Entitled + platform up, but Safe Launch restricts delivery to an allowlist.
  if (platform.testMode) {
    return {
      ...capability,
      restricted: true,
      reasonCode: "RESTRICTED_TEST_MODE",
      message: RESTRICTED_MESSAGE,
    };
  }
  return capability;
}
