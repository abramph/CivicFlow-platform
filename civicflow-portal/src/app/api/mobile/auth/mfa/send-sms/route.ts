import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { sendSms } from "@/lib/sms";
import { generateOtpCode, hashOtpCode, maskPhone, otpExpiresAt } from "@/lib/sms-otp";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ mfaToken: z.string().min(1) });

/**
 * SMS fallback for the mobile MFA challenge, for someone who can't access
 * their authenticator app or backup codes — mirrors auth/mfa/send-sms, keyed
 * by the pending challenge token instead of a NextAuth session.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { mfaToken } = await parseJsonBody(request, bodySchema);

    const challenge = await prisma.mfaChallengeToken.findUnique({ where: { token: mfaToken } });
    if (!challenge || challenge.type !== "pending" || challenge.expiresAt < new Date()) {
      return Response.json({ ok: false, error: "Challenge expired. Please log in again." }, { status: 401 });
    }

    const rateLimited = await requireRateLimit({
      scope: `mobile-mfa-sms-send:${challenge.userId}`,
      request,
      limit: 3,
      windowMs: 10 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    const user = await prisma.user.findUnique({
      where: { id: challenge.userId },
      select: { phone: true, phoneVerified: true },
    });
    if (!user?.phone || !user.phoneVerified) {
      return Response.json(
        { ok: false, error: "No verified phone number on file. Use a backup code instead." },
        { status: 400 }
      );
    }

    await prisma.mfaChallengeToken.deleteMany({ where: { userId: challenge.userId, type: "sms_otp" } });

    const code = generateOtpCode();
    await prisma.mfaChallengeToken.create({
      data: {
        userId: challenge.userId,
        type: "sms_otp",
        phone: user.phone,
        codeHash: hashOtpCode(code),
        expiresAt: otpExpiresAt(),
      },
    });

    const result = await sendSms({ to: user.phone, body: `Your Unestra sign-in code is ${code}. It expires in 10 minutes.` });

    return Response.json({ ok: true, sent: result.sent, skipped: result.skipped, maskedPhone: maskPhone(user.phone) });
  });
}
