import { withApiErrorHandling } from "@/lib/api-route";
import { signMobileTokenPair, verifyRefreshToken } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  refreshToken: z.string().min(1),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "mobile-auth-refresh",
      request,
      limit: 30,
      windowMs: 5 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    const { refreshToken } = await parseJsonBody(request, bodySchema);
    const userId = await verifyRefreshToken(refreshToken);
    if (!userId) {
      return Response.json({ ok: false, error: "Invalid or expired refresh token." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      return Response.json({ ok: false, error: "Account no longer exists." }, { status: 401 });
    }

    const tokens = await signMobileTokenPair(user.id);
    return Response.json({ ok: true, data: tokens });
  });
}
