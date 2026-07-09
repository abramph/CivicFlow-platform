import { acceptMemberInvite } from "@/lib/accept-invite";
import { withApiErrorHandling } from "@/lib/api-route";
import { isValidE164Phone } from "@/lib/phone";
import { getClientIp, requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const bodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
  phone: z.string().trim().max(20).optional(),
  smsOptIn: z.boolean().optional(),
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

    const { token, password, phone, smsOptIn } = await parseJsonBody(request, bodySchema);

    if (phone && !isValidE164Phone(phone)) {
      throw new ValidationError("Enter a valid phone number in international format, e.g. +15551234567.");
    }

    const result = await acceptMemberInvite(
      token,
      password,
      phone ? { phone, optIn: Boolean(smsOptIn), ip: getClientIp(request) } : undefined
    );
    if (!result.ok) throw new ValidationError(result.error);

    return Response.json({ ok: true, data: { user: result.user } });
  });
}
