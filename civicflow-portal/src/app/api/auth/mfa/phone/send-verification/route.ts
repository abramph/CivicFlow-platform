import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { sendSms } from "@/lib/sms";
import { generateOtpCode, hashOtpCode, isValidE164Phone, otpExpiresAt } from "@/lib/sms-otp";

/**
 * Sends a one-time code to a candidate phone number so its owner can prove
 * they control it before it's trusted as an MFA/SMS-backup destination.
 * Requires a fully authenticated (non-MFA-pending) session — adding a phone
 * number is an account-settings change, not part of the login flow itself.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimited = await requireRateLimit({
    scope: `mfa-phone-verify-send:${session.userId}`,
    request,
    limit: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (rateLimited) return rateLimited;

  const body = await request.json().catch(() => ({}));
  const phone = String(body.phone ?? "").trim();

  if (!isValidE164Phone(phone)) {
    return Response.json(
      { error: "Enter a valid phone number in international format, e.g. +15551234567." },
      { status: 400 }
    );
  }

  // Only one pending verification per user at a time.
  await prisma.mfaChallengeToken.deleteMany({ where: { userId: session.userId, type: "phone_verify" } });

  const code = generateOtpCode();
  await prisma.mfaChallengeToken.create({
    data: {
      userId: session.userId,
      type: "phone_verify",
      phone,
      codeHash: hashOtpCode(code),
      expiresAt: otpExpiresAt(),
    },
  });

  const result = await sendSms({ to: phone, body: `Your Unestra verification code is ${code}. It expires in 10 minutes.` });

  return Response.json({ ok: true, sent: result.sent, skipped: result.skipped });
}
