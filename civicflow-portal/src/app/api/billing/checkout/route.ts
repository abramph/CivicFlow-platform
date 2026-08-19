import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import {
  getOrCreateStripeCustomer,
  createCheckoutSession,
  priceIdForPlan,
  seatPriceIdForPlan,
} from "@/lib/stripe";
import { resolvePricingVertical, type CloudPlanId } from "@/lib/plans";
import { getServerEnv } from "@/lib/env";

/**
 * Unestra Cloud (CLOUD-D): the client requests only a billing interval —
 * never a plan id, vertical, or price. The plan is resolved entirely
 * server-side from the organization's own authoritative `primaryVertical`
 * (with HOA folding into COMMUNITY, see resolvePricingVertical). This
 * makes "an org checks out on a different vertical's price" structurally
 * impossible rather than merely validated — there is no client input path
 * that could select a different plan.
 */
const checkoutSchema = z.object({
  interval: z.enum(["month", "year"]).default("month"),
  additionalSeats: z.number().int().min(0).max(50).default(0),
});

function cloudPlanIdFor(vertical: "PTA" | "COMMUNITY" | "CHURCH" | "UNION", interval: "month" | "year"): CloudPlanId {
  const key = vertical.toLowerCase() as "pta" | "community" | "church" | "union";
  return `${key}_${interval === "month" ? "monthly" : "annual"}` as CloudPlanId;
}

export async function POST(req: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("billing:manage", "throw");

    const body = await parseJsonBody(req, checkoutSchema);
    const env = getServerEnv();

    const [org, activeSubscription] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, email: true, plan: true, primaryVertical: true },
      }),
      prisma.subscription.findFirst({
        where: {
          organizationId,
          status: { in: ["active", "trialing", "past_due"] },
        },
        select: { id: true },
      }),
    ]);

    if (!org) {
      return Response.json({ error: "Organization not found" }, { status: 404 });
    }

    // Orgs with an active Stripe subscription must use the billing portal to
    // change plans — creating a new checkout session would produce a duplicate
    // subscription in Stripe.
    if (activeSubscription) {
      throw new ValidationError(
        "Your organization already has an active subscription. Use the billing portal to change or cancel your plan."
      );
    }

    const plan = cloudPlanIdFor(resolvePricingVertical(org.primaryVertical), body.interval ?? "month");

    if (org.plan === plan) {
      throw new ValidationError("Your organization is already on this plan.");
    }

    const priceId = priceIdForPlan(plan);
    const extraSeats = body.additionalSeats ?? 0;
    const seatPriceId = extraSeats > 0 ? seatPriceIdForPlan(plan) : null;

    const stripeCustomerId = await getOrCreateStripeCustomer(
      organizationId,
      org.name,
      org.email
    );

    const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");
    const url = await createCheckoutSession({
      organizationId,
      stripeCustomerId,
      priceId,
      seatPriceId,
      additionalSeats: extraSeats,
      successUrl: `${baseUrl}/settings/billing?success=1`,
      cancelUrl: `${baseUrl}/settings/billing`,
    });

    return Response.json({ url, plan });
  });
}
