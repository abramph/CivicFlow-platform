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
