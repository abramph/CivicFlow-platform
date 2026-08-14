import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { startPaymentMethodUpdate } from "@/lib/giving/recurring-self-service";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { getServerEnv } from "@/lib/env";

const bodySchema = z.object({ organizationId: z.string().min(1) });

/** CORE-GIVE-D — start a SETUP-mode Stripe session to replace the schedule's
 * payment method. Card data never touches Unestra; the webhook applies it. */
export async function POST(request: Request, { params }: { params: Promise<{ scheduleId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:giving:pm-update", request, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { scheduleId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const memberSession = await requireMemberWebSession(input.organizationId);
    const env = getServerEnv();
    const url = await startPaymentMethodUpdate({
      organizationId: memberSession.organizationId,
      contributorUserId: memberSession.userId,
      scheduleId,
      baseUrl: env.NEXTAUTH_URL.replace(/\/$/, ""),
    });
    return Response.json({ ok: true, url });
  });
}
