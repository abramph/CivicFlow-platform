import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  platform: z.enum(["ios", "android", "web"]),
  token: z.string().min(1),
  deviceName: z.string().trim().max(200).optional(),
  organizationId: z.string().min(1).optional(),
});

/**
 * POST /api/mobile/register-device
 * Upserts a push token for the calling user's device. organizationId is
 * optional (a token can be global across the user's orgs); when provided it
 * is stored as-is since MobileDeviceToken is just a delivery target, not a
 * data-access boundary — no per-org verification needed here.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "mobile-register-device",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { userId } = await requireMobileAuth(request);
    const { platform, token, deviceName, organizationId } = await parseJsonBody(request, bodySchema);

    const row = await prisma.mobileDeviceToken.upsert({
      where: { userId_token: { userId, token } },
      create: { userId, token, platform, deviceName, organizationId },
      update: { platform, deviceName, organizationId, lastSeenAt: new Date() },
    });

    return Response.json({ ok: true, data: row });
  });
}
