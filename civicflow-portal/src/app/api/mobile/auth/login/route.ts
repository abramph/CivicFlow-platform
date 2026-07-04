import bcrypt from "bcryptjs";
import { withApiErrorHandling } from "@/lib/api-route";
import { signMobileTokenPair } from "@/lib/mobile-auth";
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
      return Response.json(
        { ok: false, error: "mfa_required_use_portal", message: "This account has multi-factor authentication enabled. Please log in via the CivicFlow web portal." },
        { status: 403 }
      );
    }

    const membershipCount = await prisma.organizationMembership.count({
      where: { userId: user.id, role: "MEMBER", organization: { status: "active" } },
    });
    if (membershipCount === 0) {
      return Response.json(
        { ok: false, error: "This account is not set up as a CivicFlow member. Ask your organization for an app invite." },
        { status: 403 }
      );
    }

    const tokens = await signMobileTokenPair(user.id);
    return Response.json({
      ok: true,
      data: {
        ...tokens,
        user: { id: user.id, email: user.email, displayName: user.displayName },
      },
    });
  });
}
