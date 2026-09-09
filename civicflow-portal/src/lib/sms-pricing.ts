/**
 * SMS is a paid add-on, never bundled free into any plan (SMS costs real
 * per-message money via Twilio). This is the single source of truth for its
 * pricing — read by the billing UI, the entitlement checks, and the Stripe
 * helpers, so pricing only ever needs to change in one place.
 */
export const SMS_ADDON = {
  monthlyPriceCents: 1000, // $10.00/month
  includedMessagesPerMonth: 1000,
  overageRateCents: 2, // $0.02 per message over the included allowance
  /** Env var holding the Stripe recurring Price ID for the add-on — see docs/sms-setup.md. */
  stripePriceEnvKey: "STRIPE_PRICE_SMS_ADDON_MONTHLY",
} as const;

export type SmsOveragePolicy = "unresolved" | "hard_stop" | "metered_overage";

/**
 * OWNER DECISION GATE — do not change without an explicit product-owner
 * decision (docs/sms-overage-policy-options.md).
 *
 * The 2026-09 audit found the advertised $0.02/message overage was metered
 * (smsUsedThisPeriod) but never invoiced — a silent unbilled soft cap. Until
 * the owner picks a policy, this stays "unresolved", which fails closed in
 * two places:
 *   - activation guard: neither the paid self-serve flow
 *     (/api/billing/sms-addon POST) nor the super-admin enrollment endpoint
 *     will newly activate the add-on;
 *   - send-time quota: getSmsEntitlement hard-stops at smsMonthlyLimit
 *     instead of allowing unbilled overage.
 *
 * "hard_stop" (Option A) keeps the hard quota stop but re-opens activation.
 * "metered_overage" (Option B) restores the soft cap and REQUIRES the Stripe
 * overage-invoicing implementation described in the options doc — do not set
 * it before that exists, or overage becomes unbilled again.
 */
export const SMS_OVERAGE_POLICY: SmsOveragePolicy = "unresolved";
