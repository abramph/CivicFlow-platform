import bcrypt from "bcryptjs";
import { withApiErrorHandling } from "@/lib/api-route";
import { completeMobileLogin } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "mobile-auth-login",
      request,
      limit: 10,
      windowMs: 5 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    const { email, password } = await parseJsonBody(request, bodySchema);
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return Response.json({ ok: false, error: "Invalid email or password." }, { status: 401 });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return Response.json({ ok: false, error: "Invalid email or password." }, { status: 401 });
    }

    if (user.mfaEnabled) {
      // Password verified but a second factor is required — issue a
      // short-lived challenge token (verified by mobile/auth/mfa/challenge)
      // instead of full session tokens. Mirrors the web login flow's
      // "pending" MfaChallengeToken, just without a NextAuth session cookie
      // to carry the pending state between requests.
      await prisma.mfaChallengeToken.deleteMany({
        where: { userId: user.id, type: "pending", expiresAt: { lt: new Date() } },
      });
      const challenge = await prisma.mfaChallengeToken.create({
        data: { userId: user.id, type: "pending", expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
      });
      return Response.json({ ok: true, mfaRequired: true, mfaToken: challenge.token });
    }

    const result = await completeMobileLogin(user);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }
    return Response.json({ ok: true, data: result.data });
  });
}
