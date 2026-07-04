import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  deviceToken: z.string().optional(),
});

/**
 * Secure logout: access/refresh tokens are short-lived and stateless, so the
 * client is responsible for discarding them. This endpoint's job is to stop
 * this device from receiving further push notifications for this account.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { userId } = await requireMobileAuth(request);
    const { deviceToken } = await parseJsonBody(request, bodySchema);

    if (deviceToken) {
      await prisma.mobileDeviceToken.deleteMany({ where: { userId, token: deviceToken } });
    }

    return Response.json({ ok: true });
  });
}
