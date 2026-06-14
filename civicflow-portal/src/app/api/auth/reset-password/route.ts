import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { consumeToken } from "@/lib/auth-tokens";

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, resetSchema);
    const result = await consumeToken(input.token, "password_reset");

    if (!result.ok) {
      throw new ValidationError(result.error);
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    await prisma.user.update({
      where: { id: result.userId },
      data: { passwordHash, emailVerified: true },
    });

    return Response.json({ ok: true });
  });
}
