/**
 * SMS is a paid add-on, never bundled free into any plan (SMS costs real
 * per-message money via Twilio). This is the single source of truth for its
 * pricing — read by the billing UI, the entitlement checks, and the Stripe
 * helpers, so pricing only ever needs to change in one place.
 */
export const SMS_ADDON = {
  monthlyPriceCents: 1000, // $10.00/month
  includedMessagesPerMonth: 1000,
  /**
   * LEGACY / internal-only. Under the owner-selected hard-stop policy there
   * is NO customer-facing overage billing — sending pauses at the monthly
   * allowance. This constant remains only to seed the compatibility DB
   * column OrganizationSmsSettings.smsOverageRateCents and the super-admin
   * internal cost dashboard (SMS_PLAN_TIERS); it must never be presented to
   * customers as an active billing rate.
   */
  overageRateCents: 2,
  /** Env var holding the Stripe recurring Price ID for the add-on — see docs/sms-setup.md. */
  stripePriceEnvKey: "STRIPE_PRICE_SMS_ADDON_MONTHLY",
} as const;

export type SmsOveragePolicy = "unresolved" | "hard_stop" | "metered_overage";

/**
 * OWNER DECISION (2026-09-08, docs/sms-overage-policy-options.md):
 * **Option A — "hard_stop"** was explicitly selected. Sending stops when
 * smsUsedThisPeriod reaches smsMonthlyLimit, enforced by a database-atomic
 * reservation (reserveSmsAllowance in lib/sms-entitlement.ts) immediately
 * before every organization-message Twilio call — no unbilled overage can
 * occur, and activation of the add-on is open.
 *
 * Do not change this value without a new explicit product-owner decision:
 *   - "unresolved" re-closes activation everywhere (the pre-decision state);
 *   - "metered_overage" (Option B) would restore the soft cap and REQUIRES
 *     the Stripe overage-invoicing implementation described in the options
 *     doc first — setting it before that exists reintroduces unbilled
 *     overage, the exact defect the 2026-09 audit flagged.
 */
export const SMS_OVERAGE_POLICY: SmsOveragePolicy = "hard_stop";
