import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { consumeToken } from "@/lib/auth-tokens";

const verifySchema = z.object({
  token: z.string().min(1),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, verifySchema);
    const result = await consumeToken(input.token, "email_verification");

    if (!result.ok) {
      throw new ValidationError(result.error);
    }

    await prisma.user.update({
      where: { id: result.userId },
      data: { emailVerified: true },
    });

    return Response.json({ ok: true });
  });
}
