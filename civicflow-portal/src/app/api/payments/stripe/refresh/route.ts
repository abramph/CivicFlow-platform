import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { requireRateLimit } from "@/lib/rate-limit";
import { refreshAccountStatus } from "@/lib/payments/stripe-connect";

/** CONNECT-B (§6/§27) — provider-truth status sync. The ONLY path that
 * advances connection state; returning from Stripe proves nothing. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:payments:stripe:refresh", request, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId } = await requirePermission("payments:stripe:refresh", "throw");
    const view = await refreshAccountStatus(organizationId);
    return Response.json({ ok: true, data: view });
  });
}
