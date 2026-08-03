import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { hashOtpCode } from "@/lib/sms-otp";
import { withApiErrorHandling } from "@/lib/api-route";

/** Confirms the code sent by /send-verification and, on success, persists the phone number as verified. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimited = await requireRateLimit({
      scope: `mfa-phone-verify-confirm:${session.userId}`,
      request,
      limit: 10,
      windowMs: 15 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    const body = await request.json().catch(() => ({}));
    const code = String(body.code ?? "").trim().replace(/\s/g, "");
    if (!code) {
      return Response.json({ error: "Code is required" }, { status: 400 });
    }

    const record = await prisma.mfaChallengeToken.findFirst({
      where: { userId: session.userId, type: "phone_verify" },
      orderBy: { createdAt: "desc" },
    });

    if (!record || !record.phone || !record.codeHash || record.expiresAt < new Date()) {
      return Response.json({ error: "Verification code expired. Request a new one." }, { status: 400 });
    }

    if (hashOtpCode(code) !== record.codeHash) {
      return Response.json({ error: "Invalid code. Please try again." }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: session.userId }, data: { phone: record.phone, phoneVerified: true } }),
      prisma.mfaChallengeToken.delete({ where: { id: record.id } }),
    ]);

    return Response.json({ ok: true });
  });
}
