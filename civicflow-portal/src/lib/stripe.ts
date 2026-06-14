import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    _stripe = new Stripe(key, { apiVersion: "2025-05-28.basil" });
  }
  return _stripe;
}

export function stripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return secret;
}

export function priceIdForPlan(planId: "essential" | "elite"): string {
  const key =
    planId === "essential"
      ? process.env.STRIPE_PRICE_ESSENTIAL_MONTHLY
      : process.env.STRIPE_PRICE_ELITE_MONTHLY;
  if (!key) throw new Error(`Stripe price not configured for plan: ${planId}`);
  return key;
}

export function planFromPriceId(priceId: string): "essential" | "elite" | null {
  if (priceId === process.env.STRIPE_PRICE_ESSENTIAL_MONTHLY) return "essential";
  if (priceId === process.env.STRIPE_PRICE_ELITE_MONTHLY) return "elite";
  return null;
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
  successUrl,
  cancelUrl,
}: {
  organizationId: string;
  stripeCustomerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
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
