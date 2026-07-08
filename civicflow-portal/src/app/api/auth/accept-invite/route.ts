import { acceptMemberInvite } from "@/lib/accept-invite";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const bodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

/** Web equivalent of /api/mobile/auth/accept-invite — no bearer tokens; the
 * member logs in normally afterward to get a NextAuth session. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "web-auth-accept-invite",
      request,
      limit: 10,
      windowMs: 15 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    const { token, password } = await parseJsonBody(request, bodySchema);
    const result = await acceptMemberInvite(token, password);
    if (!result.ok) throw new ValidationError(result.error);

    return Response.json({ ok: true, data: { user: result.user } });
  });
}
