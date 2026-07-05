import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { sendSms } from "@/lib/sms";
import { generateOtpCode, hashOtpCode, maskPhone, otpExpiresAt } from "@/lib/sms-otp";

/**
 * Sends a one-time SMS code during the login MFA challenge, as a fallback
 * for someone who can't access their authenticator app or backup codes.
 * Only usable mid-login (mfaPending session) against a phone number the
 * account already verified ahead of time via /api/auth/mfa/phone/confirm.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.mfaPending || !session.mfaUserId || !session.mfaTokenId) {
    return Response.json({ error: "No pending MFA challenge" }, { status: 401 });
  }

  const challengeRecord = await prisma.mfaChallengeToken.findUnique({ where: { id: session.mfaTokenId } });
  if (
    !challengeRecord ||
    challengeRecord.type !== "pending" ||
    challengeRecord.expiresAt < new Date() ||
    challengeRecord.userId !== session.mfaUserId
  ) {
    return Response.json({ error: "Challenge expired. Please log in again." }, { status: 401 });
  }

  const rateLimited = await requireRateLimit({
    scope: `mfa-sms-send:${session.mfaUserId}`,
    request,
    limit: 3,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimited) return rateLimited;

  const user = await prisma.user.findUnique({
    where: { id: session.mfaUserId },
    select: { phone: true, phoneVerified: true },
  });

  if (!user?.phone || !user.phoneVerified) {
    return Response.json(
      { error: "No verified phone number on file. Use a backup code, then add a phone number in Security Settings." },
      { status: 400 }
    );
  }

  await prisma.mfaChallengeToken.deleteMany({ where: { userId: session.mfaUserId, type: "sms_otp" } });

  const code = generateOtpCode();
  await prisma.mfaChallengeToken.create({
    data: {
      userId: session.mfaUserId,
      type: "sms_otp",
      phone: user.phone,
      codeHash: hashOtpCode(code),
      expiresAt: otpExpiresAt(),
    },
  });

  const result = await sendSms({ to: user.phone, body: `Your CivicFlow sign-in code is ${code}. It expires in 10 minutes.` });

  return Response.json({ ok: true, sent: result.sent, skipped: result.skipped, maskedPhone: maskPhone(user.phone) });
}
