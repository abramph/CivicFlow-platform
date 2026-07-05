import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  deviceToken: z.string().optional(),
});

/**
 * Secure logout: bumps mobileTokenVersion, which immediately invalidates
 * every outstanding access/refresh token for this user — not just the
 * current device's. Also stops this device from receiving further push
 * notifications for this account.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { userId } = await requireMobileAuth(request);
    const { deviceToken } = await parseJsonBody(request, bodySchema);

    if (deviceToken) {
      await prisma.mobileDeviceToken.deleteMany({ where: { userId, token: deviceToken } });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { mobileTokenVersion: { increment: 1 } },
    });

    return Response.json({ ok: true });
  });
}
