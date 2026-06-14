import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import {
  getOrCreateStripeCustomer,
  createCheckoutSession,
  priceIdForPlan,
} from "@/lib/stripe";
import { getServerEnv } from "@/lib/env";

const checkoutSchema = z.object({
  plan: z.enum(["essential", "elite"]),
});

export async function POST(req: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("billing:manage", "throw");

    const body = await parseJsonBody(req, checkoutSchema);
    const env = getServerEnv();

    const priceId = priceIdForPlan(body.plan);

    const [org, activeSubscription] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, email: true, plan: true },
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

    if (org.plan === body.plan) {
      throw new ValidationError("Your organization is already on this plan.");
    }

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
      successUrl: `${baseUrl}/settings/billing?success=1`,
      cancelUrl: `${baseUrl}/settings/billing`,
    });

    return Response.json({ url });
  });
}
