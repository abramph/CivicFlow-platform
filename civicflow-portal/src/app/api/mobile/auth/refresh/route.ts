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
    const claims = await verifyRefreshToken(refreshToken);
    if (!claims) {
      return Response.json({ ok: false, error: "Invalid or expired refresh token." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: claims.userId },
      select: { id: true, mobileTokenVersion: true },
    });
    if (!user || user.mobileTokenVersion !== claims.tokenVersion) {
      return Response.json({ ok: false, error: "Invalid or expired refresh token." }, { status: 401 });
    }

    const tokens = await signMobileTokenPair(user.id, user.mobileTokenVersion);
    return Response.json({ ok: true, data: tokens });
  });
}
