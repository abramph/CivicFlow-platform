import Stripe from "stripe";
import { SMS_ADDON } from "@/lib/sms-pricing";
import { PLANS, type PlanId, type BillingInterval } from "@/lib/plans";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    _stripe = new Stripe(key, { apiVersion: "2024-06-20" });
  }
  return _stripe;
}

export function stripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return secret;
}

/**
 * Resolves the Stripe Price env var for a plan+interval directly from the
 * plan catalog (plans.ts) rather than a hardcoded per-plan branch — every
 * Cloud plan (and the legacy essential/elite tiers) resolves through the
 * same path. Cloud plan ids already encode their own interval (e.g.
 * "pta_monthly"); for those, the passed `interval` is ignored in favor of
 * the plan's own `interval` field. For legacy plans (whose id has no
 * interval baked in), `interval` selects monthly vs. yearly.
 */
export function priceIdForPlan(planId: PlanId, interval: BillingInterval = "month"): string {
  const plan = PLANS[planId];
  const effectiveInterval = plan.interval ?? interval;
  const envKey = effectiveInterval === "year" ? plan.yearlyPriceEnvKey : plan.monthlyPriceEnvKey;
  const key = envKey ? process.env[envKey] : undefined;
  if (!key) throw new Error(`Stripe price not configured for plan: ${planId} (${effectiveInterval})`);
  return key;
}

export function planFromPriceId(priceId: string): PlanId | null {
  for (const plan of Object.values(PLANS)) {
    const configuredIds = [plan.monthlyPriceEnvKey, plan.yearlyPriceEnvKey]
      .filter((envKey): envKey is string => Boolean(envKey))
      .map((envKey) => process.env[envKey]);
    if (configuredIds.includes(priceId)) return plan.id;
  }
  return null;
}

export function seatPriceIdForPlan(planId: PlanId, interval: BillingInterval = "month"): string | null {
  const plan = PLANS[planId];
  const envKey = interval === "year" ? plan.seatYearlyPriceEnvKey : plan.seatMonthlyPriceEnvKey;
  return envKey ? (process.env[envKey] ?? null) : null;
}

export function isSeatPriceId(priceId: string): boolean {
  return Object.values(PLANS).some((plan) => {
    const configuredIds = [plan.seatMonthlyPriceEnvKey, plan.seatYearlyPriceEnvKey]
      .filter((envKey): envKey is string => Boolean(envKey))
      .map((envKey) => process.env[envKey]);
    return configuredIds.includes(priceId);
  });
}

export function smsAddOnPriceId(): string {
  const priceId = process.env[SMS_ADDON.stripePriceEnvKey];
  if (!priceId) throw new Error(`Stripe price not configured for the SMS add-on (${SMS_ADDON.stripePriceEnvKey})`);
  return priceId;
}

export function isSmsAddOnPriceId(priceId: string): boolean {
  return priceId === process.env[SMS_ADDON.stripePriceEnvKey];
}

/** Adds the SMS add-on as a new line item on an existing subscription (prorated automatically by Stripe). */
export async function addSmsAddOnToSubscription(stripeSubscriptionId: string): Promise<{ subscriptionItemId: string }> {
  const stripe = getStripe();
  const item = await stripe.subscriptionItems.create({
    subscription: stripeSubscriptionId,
    price: smsAddOnPriceId(),
  });
  return { subscriptionItemId: item.id };
}

/** Removes the SMS add-on line item (prorated automatically by Stripe). */
export async function removeSmsAddOnFromSubscription(subscriptionItemId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptionItems.del(subscriptionItemId);
}

export async function getOrCreateStripeCustomer(
  organizationId: string,
  name: string,
  email: string | null
): Promise<string> {
  const stripe = getStripe();

  const { prisma } = await import("@/lib/prisma");
  const existing = await prisma.subscription.findFirst({
    where: { organizationId, stripeCustomerId: { not: null } },
    select: { stripeCustomerId: true },
  });

  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const customer = await stripe.customers.create({
    name,
    ...(email ? { email } : {}),
    metadata: { product: "Unestra", platformOwner: "APH Technologies, LLC", organizationId },
  });

  return customer.id;
}

export async function createCheckoutSession({
  organizationId,
  stripeCustomerId,
  priceId,
  seatPriceId,
  additionalSeats,
  successUrl,
  cancelUrl,
}: {
  organizationId: string;
  stripeCustomerId: string;
  priceId: string;
  seatPriceId?: string | null;
  additionalSeats?: number;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const stripe = getStripe();

  const lineItems: { price: string; quantity: number }[] = [{ price: priceId, quantity: 1 }];
  if (seatPriceId && additionalSeats && additionalSeats > 0) {
    lineItems.push({ price: seatPriceId, quantity: additionalSeats });
  }

  const metadata = {
    product: "Unestra",
    platformOwner: "APH Technologies, LLC",
    organizationId,
    environment: process.env.NODE_ENV ?? "development",
  };

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "subscription",
    line_items: lineItems,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata,
    subscription_data: { metadata },
    allow_promotion_codes: true,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

export async function createBillingPortalSession({
  stripeCustomerId,
  returnUrl,
}: {
  stripeCustomerId: string;
  returnUrl: string;
}): Promise<string> {
  const stripe = getStripe();

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}
