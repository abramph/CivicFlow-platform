import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { isValidE164Phone } from "@/lib/phone";
import { requireRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/sms";
import { generateOtpCode, hashOtpCode, otpExpiresAt } from "@/lib/sms-otp";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  phone: z.string().trim().min(1),
});

/**
 * Sends a one-time code to a candidate phone number so a member can prove
 * they control it before SMS consent is recorded for it. Shared by the
 * Notification Settings page and the public /sms-opt-in landing page.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, phone } = await parseJsonBody(request, bodySchema);
    const { userId } = await requireMemberWebSession(organizationId);

    const rateLimited = await requireRateLimit({
      scope: `member-sms-optin-send:${userId}`,
      request,
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    if (!isValidE164Phone(phone)) {
      return Response.json(
        { ok: false, error: "Enter a valid phone number in international format, e.g. +15551234567." },
        { status: 400 }
      );
    }

    // Only one pending SMS opt-in verification per user at a time.
    await prisma.mfaChallengeToken.deleteMany({ where: { userId, type: "sms_opt_in" } });

    const code = generateOtpCode();
    await prisma.mfaChallengeToken.create({
      data: {
        userId,
        type: "sms_opt_in",
        phone,
        codeHash: hashOtpCode(code),
        expiresAt: otpExpiresAt(),
      },
    });

    const result = await sendSms({ to: phone, body: `Your Unestra verification code is ${code}. It expires in 10 minutes.` });

    return Response.json({ ok: true, sent: result.sent, skipped: result.skipped });
  });
}
