import { acceptPtaHouseholdAdultInvite } from "@/lib/labs/pta/accept-household-adult-invite";
import { withApiErrorHandling } from "@/lib/api-route";
import { signMobileTokenPair } from "@/lib/mobile-auth";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const bodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "mobile-auth-accept-pta-household-invite",
      request,
      limit: 10,
      windowMs: 15 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    const { token, password } = await parseJsonBody(request, bodySchema);
    const result = await acceptPtaHouseholdAdultInvite(token, password);
    if (!result.ok) throw new ValidationError(result.error);

    const tokens = await signMobileTokenPair(result.user.id, result.mobileTokenVersion);
    return Response.json({ ok: true, data: { ...tokens, user: result.user } });
  });
}
