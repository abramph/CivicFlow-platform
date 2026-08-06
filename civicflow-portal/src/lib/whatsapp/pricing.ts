/**
 * WhatsApp is a paid add-on, mirroring SMS_ADDON in lib/sms-pricing.ts — a
 * single source of truth so pricing only changes in one place. These are
 * placeholder figures for internal cost estimation only (WhatsAppMessage.
 * costEstimateCents) — not a customer-facing pricing decision. No UI in this
 * PR reads or displays these values.
 */
export const WHATSAPP_ADDON = {
  monthlyPriceCents: 1500, // $15.00/month — placeholder, WhatsApp conversations are typically pricier than SMS
  includedMessagesPerMonth: 500,
  overageRateCents: 5, // $0.05 per message over the included allowance — placeholder
  /** Env var holding the Stripe recurring Price ID for the add-on, once one exists. */
  stripePriceEnvKey: "STRIPE_PRICE_WHATSAPP_ADDON_MONTHLY",
} as const;
