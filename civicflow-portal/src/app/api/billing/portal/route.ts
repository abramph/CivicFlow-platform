import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";
import { createBillingPortalSession } from "@/lib/stripe";
import { getServerEnv } from "@/lib/env";

export async function POST(req: Request) {
  return withApiErrorHandling(async () => {
    // Suppress unused warning — body is intentionally empty
    void req;

    // Recovery-path allowlist (LAUNCH-BLOCKER subscription gate): an
    // existing-subscription-management route must stay reachable even when
    // the org itself is billing-inactive (past_due, canceled, etc.) — that's
    // exactly when an owner needs the portal most.
    const { organizationId } = await requirePermission("billing:manage", "throw", { skipEntitlementGate: true });
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
