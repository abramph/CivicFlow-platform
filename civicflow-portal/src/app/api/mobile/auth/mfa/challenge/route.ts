import bcrypt from "bcryptjs";
import { withApiErrorHandling } from "@/lib/api-route";
import { completeMobileLogin } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { hashOtpCode } from "@/lib/sms-otp";
import { totpVerify } from "@/lib/totp";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  mfaToken: z.string().min(1),
  code: z.string().min(1),
});

/**
 * Second step of mobile login for an account with MFA enabled — verifies
 * the code against the pending challenge from mobile/auth/login and, on
 * success, issues real mobile bearer tokens directly (no NextAuth session
 * involved, unlike the web flow's separate completion-token exchange).
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "mobile-auth-mfa-challenge",
      request,
      limit: 10,
      windowMs: 5 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    const { mfaToken, code } = await parseJsonBody(request, bodySchema);
    const normalizedCode = code.trim().replace(/\s/g, "");

    const challenge = await prisma.mfaChallengeToken.findUnique({ where: { token: mfaToken } });
    if (!challenge || challenge.type !== "pending" || challenge.expiresAt < new Date()) {
      return Response.json({ ok: false, error: "Challenge expired. Please log in again." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: challenge.userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        mobileTokenVersion: true,
        mfaSecret: true,
        mfaBackupCodes: true,
      },
    });
    if (!user?.mfaSecret) {
      return Response.json({ ok: false, error: "MFA not configured" }, { status: 400 });
    }

    let verified = false;
    let smsOtpRecordId: string | null = null;

    if (normalizedCode.length === 8) {
      for (let i = 0; i < user.mfaBackupCodes.length; i++) {
        const match = await bcrypt.compare(normalizedCode.toUpperCase(), user.mfaBackupCodes[i]);
        if (match) {
          const remaining = [...user.mfaBackupCodes];
          remaining.splice(i, 1);
          await prisma.user.update({ where: { id: user.id }, data: { mfaBackupCodes: remaining } });
          verified = true;
          break;
        }
      }
    } else {
      verified = totpVerify(normalizedCode, user.mfaSecret);
      // Not a valid TOTP code — it may be the SMS one-time code sent via
      // mobile/auth/mfa/send-sms instead (both are 6 digits).
      if (!verified) {
        const smsRecord = await prisma.mfaChallengeToken.findFirst({
          where: { userId: user.id, type: "sms_otp", expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
        });
        if (smsRecord?.codeHash && smsRecord.codeHash === hashOtpCode(normalizedCode)) {
          verified = true;
          smsOtpRecordId = smsRecord.id;
        }
      }
    }

    if (!verified) {
      return Response.json({ ok: false, error: "Invalid code. Please try again." }, { status: 400 });
    }

    if (smsOtpRecordId) {
      await prisma.mfaChallengeToken.delete({ where: { id: smsOtpRecordId } }).catch(() => {});
    }
    await prisma.mfaChallengeToken.delete({ where: { id: challenge.id } }).catch(() => {});

    const result = await completeMobileLogin(user);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }
    return Response.json({ ok: true, data: result.data });
  });
}
