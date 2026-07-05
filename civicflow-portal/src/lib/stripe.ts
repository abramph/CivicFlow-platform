import Stripe from "stripe";
import { SMS_ADDON } from "@/lib/sms-pricing";

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

export function priceIdForPlan(planId: "essential" | "elite", interval: "month" | "year" = "month"): string {
  const key =
    interval === "year"
      ? planId === "essential"
        ? process.env.STRIPE_PRICE_ESSENTIAL_YEARLY
        : process.env.STRIPE_PRICE_ELITE_YEARLY
      : planId === "essential"
        ? process.env.STRIPE_PRICE_ESSENTIAL_MONTHLY
        : process.env.STRIPE_PRICE_ELITE_MONTHLY;
  if (!key) throw new Error(`Stripe price not configured for plan: ${planId} (${interval})`);
  return key;
}

export function planFromPriceId(priceId: string): "essential" | "elite" | null {
  const essentialIds = [process.env.STRIPE_PRICE_ESSENTIAL_MONTHLY, process.env.STRIPE_PRICE_ESSENTIAL_YEARLY];
  const eliteIds = [process.env.STRIPE_PRICE_ELITE_MONTHLY, process.env.STRIPE_PRICE_ELITE_YEARLY];
  if (essentialIds.includes(priceId)) return "essential";
  if (eliteIds.includes(priceId)) return "elite";
  return null;
}

export function seatPriceIdForPlan(planId: "essential" | "elite", interval: "month" | "year" = "month"): string | null {
  const key =
    interval === "year"
      ? planId === "essential"
        ? process.env.STRIPE_PRICE_ESSENTIAL_SEAT_YEARLY
        : process.env.STRIPE_PRICE_ELITE_SEAT_YEARLY
      : planId === "essential"
        ? process.env.STRIPE_PRICE_ESSENTIAL_SEAT_MONTHLY
        : process.env.STRIPE_PRICE_ELITE_SEAT_MONTHLY;
  return key ?? null;
}

export function isSeatPriceId(priceId: string): boolean {
  const seatIds = [
    process.env.STRIPE_PRICE_ESSENTIAL_SEAT_MONTHLY,
    process.env.STRIPE_PRICE_ESSENTIAL_SEAT_YEARLY,
    process.env.STRIPE_PRICE_ELITE_SEAT_MONTHLY,
    process.env.STRIPE_PRICE_ELITE_SEAT_YEARLY,
  ];
  return seatIds.includes(priceId);
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
    metadata: { organizationId },
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

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "subscription",
    line_items: lineItems,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { organizationId },
    subscription_data: { metadata: { organizationId } },
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
