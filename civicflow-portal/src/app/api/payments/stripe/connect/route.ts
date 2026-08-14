import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { requireRateLimit } from "@/lib/rate-limit";
import { startConnectOnboarding } from "@/lib/payments/stripe-connect";
import { getServerEnv } from "@/lib/env";

/** CONNECT-B (§3/§6) — start or resume Stripe-hosted onboarding for the
 * CALLER'S OWN organization. No account id, no mode, no URL is accepted
 * from the client; everything resolves server-side (§10). */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:payments:stripe:connect", request, limit: 5, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, session } = await requirePermission("payments:stripe:connect", "throw");
    const baseUrl = getServerEnv().NEXTAUTH_URL.replace(/\/$/, "");
    const result = await startConnectOnboarding({
      organizationId,
      baseUrl,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: { url: result.url, resumed: result.resumed, accountMode: result.accountMode } });
  });
}
