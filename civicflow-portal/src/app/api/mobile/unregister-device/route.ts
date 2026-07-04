import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  token: z.string().min(1),
});

export async function DELETE(request: Request) {
  return withApiErrorHandling(async () => {
    const { userId } = await requireMobileAuth(request);
    const { token } = await parseJsonBody(request, bodySchema);

    await prisma.mobileDeviceToken.deleteMany({ where: { userId, token } });

    return Response.json({ ok: true });
  });
}
