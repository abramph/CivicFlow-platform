import type { RecurringFrequency } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

/**
 * CORE-GIVE-C — MEMBER-level Stripe plumbing (docs/core-contributions-giving.md
 * §3). This module is the ONLY place giving customers/products are created.
 * It never touches Subscription or getOrCreateStripeCustomer — the SaaS
 * billing domain cannot resolve these customers and vice versa.
 */

/** One Stripe Customer per (organization, user) for giving. */
export async function getOrCreateGivingCustomer(input: {
  organizationId: string;
  userId: string;
  email: string | null;
  name: string | null;
}): Promise<string> {
  const existing = await prisma.givingCustomer.findUnique({
    where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
  });
  if (existing) return existing.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    ...(input.email ? { email: input.email } : {}),
    ...(input.name ? { name: input.name } : {}),
    metadata: {
      product: "Unestra Giving",
      platformOwner: "APH Technologies, LLC",
      domain: "member-giving",
      organizationId: input.organizationId,
      userId: input.userId,
    },
  });

  try {
    await prisma.givingCustomer.create({
      data: { organizationId: input.organizationId, userId: input.userId, stripeCustomerId: customer.id },
    });
  } catch (error) {
    // Concurrent create: keep the winner's customer, discard ours.
    const winner = await prisma.givingCustomer.findUnique({
      where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
    });
    if (winner) return winner.stripeCustomerId;
    throw error;
  }
  return customer.id;
}

/** One Stripe Product per organization for recurring giving — inline
 * price_data references it, so member-chosen amounts never create orphan
 * products (§10). */
export async function getOrCreateGivingProduct(organizationId: string): Promise<string> {
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId },
    select: { givingStripeProductId: true },
  });
  if (settings?.givingStripeProductId) return settings.givingStripeProductId;

  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const stripe = getStripe();
  const product = await stripe.products.create({
    name: `${organization?.name ?? "Organization"} — Recurring Contribution`,
    metadata: { product: "Unestra Giving", domain: "member-giving", organizationId },
  });
  await prisma.orgSettings.upsert({
    where: { organizationId },
    create: { organizationId, givingStripeProductId: product.id },
    update: { givingStripeProductId: product.id },
  });
  return product.id;
}

/** §9 frequency → Stripe recurring interval. */
export function stripeIntervalFor(frequency: RecurringFrequency): { interval: "week" | "month" | "year"; interval_count: number } {
  switch (frequency) {
    case "WEEKLY":
      return { interval: "week", interval_count: 1 };
    case "BIWEEKLY":
      return { interval: "week", interval_count: 2 };
    case "MONTHLY":
      return { interval: "month", interval_count: 1 };
    case "QUARTERLY":
      return { interval: "month", interval_count: 3 };
    case "ANNUALLY":
      return { interval: "year", interval_count: 1 };
  }
}
