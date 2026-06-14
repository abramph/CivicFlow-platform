import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";
import { createBillingPortalSession } from "@/lib/stripe";
import { getServerEnv } from "@/lib/env";

export async function POST(req: Request) {
  return withApiErrorHandling(async () => {
    // Suppress unused warning — body is intentionally empty
    void req;

    const { organizationId } = await requirePermission("billing:manage", "throw");
    const env = getServerEnv();

    const subscription = await prisma.subscription.findFirst({
      where: { organizationId, stripeCustomerId: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { stripeCustomerId: true },
    });

    if (!subscription?.stripeCustomerId) {
      return Response.json(
        { error: "No billing account found. Complete a subscription checkout first." },
        { status: 400 }
      );
    }

    const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");
    const url = await createBillingPortalSession({
      stripeCustomerId: subscription.stripeCustomerId,
      returnUrl: `${baseUrl}/settings/billing`,
    });

    return Response.json({ url });
  });
}
