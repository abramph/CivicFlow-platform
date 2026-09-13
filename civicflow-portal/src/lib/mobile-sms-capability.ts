import { getSmsEntitlement, type SmsEntitlement, type SmsEntitlementReasonCode } from "@/lib/sms-entitlement";

/**
 * The mobile app's SMS-entitlement contract. It is a deliberately NARROW
 * projection of the server's live SMS entitlement (getSmsEntitlement — the
 * single source of truth): the client learns only whether it may offer SMS as
 * a channel, a stable machine reason when it may not, a truthful short message
 * to show, the remaining monthly allowance when authorized, and whether the
 * denial is one the org can self-serve fix in Settings → Billing.
 *
 * What it deliberately never carries: Stripe price / subscription / product /
 * item ids, Twilio credentials or messaging-service/sender identifiers, the
 * org's phone-number configuration, or any raw billing amount. The client must
 * NOT re-derive entitlement from these — it switches on `available` only, and
 * routes to billing when `billingManagementRequired` is set. This mirrors how
 * the org-list endpoint exposes "does this org have this feature" booleans
 * rather than the underlying records.
 */
export interface MobileSmsCapability {
  /** True iff SMS may be offered as a channel right now. */
  available: boolean;
  /** Stable machine code when unavailable; null when available. */
  reasonCode: SmsEntitlementReasonCode | null;
  /** Truthful, non-sensitive one-liner to show the admin. Null when available. */
  message: string | null;
  /**
   * Remaining messages this billing period, surfaced ONLY when available
   * (never leak an org's limit while denying). Null when unavailable.
   */
  remaining: number | null;
  /** True when the denial is one the org can self-serve resolve via billing. */
  billingManagementRequired: boolean;
}

/**
 * User-facing copy per denial code. Kept here (server-side) so the wording is
 * a server concern and stays truthful to the actual gate — the client renders
 * it verbatim rather than composing its own explanation.
 */
const MESSAGE_BY_CODE: Record<SmsEntitlementReasonCode, string> = {
  PLATFORM_MESSAGING_DISABLED: "Text messaging is temporarily unavailable. Please try again later.",
  ADD_ON_REQUIRED: "SMS isn't part of your plan yet. Add the SMS add-on in Settings → Billing to text members.",
  SUSPENDED: "SMS messaging is suspended for your organization. Please contact support.",
  BILLING_REQUIRED: "Your subscription isn't active. Update billing in Settings → Billing to send SMS.",
  ALLOWANCE_REACHED: "You've used this month's SMS allowance. It resets at the start of your next billing period.",
};

/**
 * Only ADD_ON_REQUIRED and BILLING_REQUIRED are things an org owner can fix
 * themselves in the billing portal. A platform-wide disable or an
 * admin-imposed suspension is NOT self-serve (routing the user to a checkout
 * that can't help them would be untruthful), and a spent allowance resolves on
 * its own at period rollover.
 */
const BILLING_SELF_SERVE = new Set<SmsEntitlementReasonCode>(["ADD_ON_REQUIRED", "BILLING_REQUIRED"]);

/** Pure mapping — unit-testable without a database. */
export function toMobileSmsCapability(entitlement: SmsEntitlement): MobileSmsCapability {
  if (entitlement.allowed) {
    return {
      available: true,
      reasonCode: null,
      message: null,
      remaining: entitlement.remaining,
      billingManagementRequired: false,
    };
  }

  // A denial always carries a code; fall back defensively if an older caller
  // somehow produced a reason-only denial.
  const code = entitlement.code ?? "ADD_ON_REQUIRED";
  return {
    available: false,
    reasonCode: code,
    message: MESSAGE_BY_CODE[code],
    remaining: null,
    billingManagementRequired: BILLING_SELF_SERVE.has(code),
  };
}

/** Convenience: resolve live entitlement for an org and project it for mobile. */
export async function getMobileSmsCapability(organizationId: string): Promise<MobileSmsCapability> {
  return toMobileSmsCapability(await getSmsEntitlement(organizationId));
}
