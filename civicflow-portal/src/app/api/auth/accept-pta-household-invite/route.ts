import { acceptPtaHouseholdAdultInvite } from "@/lib/labs/pta/accept-household-adult-invite";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const bodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

/** Web equivalent of /api/mobile/auth/accept-pta-household-invite — no
 * bearer tokens; the adult logs in normally afterward to get a NextAuth
 * session. Mirrors /api/auth/accept-invite. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "web-auth-accept-pta-household-invite",
      request,
      limit: 10,
      windowMs: 15 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    const { token, password } = await parseJsonBody(request, bodySchema);

    const result = await acceptPtaHouseholdAdultInvite(token, password);
    if (!result.ok) throw new ValidationError(result.error);

    return Response.json({ ok: true, data: { user: result.user } });
  });
}
