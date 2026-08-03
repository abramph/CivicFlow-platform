import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@/lib/prisma";
import { totpVerify } from "@/lib/totp";
import { hashOtpCode } from "@/lib/sms-otp";
import { withApiErrorHandling } from "@/lib/api-route";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  return withApiErrorHandling(async () => {
    const session = await getServerSession(authOptions);

    if (!session?.mfaPending || !session.mfaUserId || !session.mfaTokenId) {
      return Response.json({ error: "No pending MFA challenge" }, { status: 401 });
    }

    // Verify the pending token is still valid
    const challengeRecord = await prisma.mfaChallengeToken.findUnique({
      where: { id: session.mfaTokenId },
    });

    if (
      !challengeRecord ||
      challengeRecord.type !== "pending" ||
      challengeRecord.expiresAt < new Date() ||
      challengeRecord.userId !== session.mfaUserId
    ) {
      return Response.json(
        { error: "Challenge expired. Please log in again." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const code = String(body.code ?? "").trim().replace(/\s/g, "");

    if (!code) {
      return Response.json({ error: "Code is required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.mfaUserId },
      select: { mfaSecret: true, mfaBackupCodes: true },
    });

    if (!user?.mfaSecret) {
      return Response.json({ error: "MFA not configured" }, { status: 400 });
    }

    let verified = false;
    let smsOtpRecordId: string | null = null;

    if (code.length === 8) {
      // Backup code attempt
      for (let i = 0; i < user.mfaBackupCodes.length; i++) {
        const match = await bcrypt.compare(code.toUpperCase(), user.mfaBackupCodes[i]);
        if (match) {
          const remaining = [...user.mfaBackupCodes];
          remaining.splice(i, 1);
          await prisma.user.update({
            where: { id: session.mfaUserId },
            data: { mfaBackupCodes: remaining },
          });
          verified = true;
          break;
        }
      }
    } else {
      verified = totpVerify(code, user.mfaSecret);

      // Not a valid TOTP code — it may be the SMS one-time code sent via
      // /api/auth/mfa/send-sms instead (both are 6 digits, so there's no way
      // to tell which was intended without checking both).
      if (!verified) {
        const smsRecord = await prisma.mfaChallengeToken.findFirst({
          where: { userId: session.mfaUserId, type: "sms_otp", expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
        });
        if (smsRecord?.codeHash && smsRecord.codeHash === hashOtpCode(code)) {
          verified = true;
          smsOtpRecordId = smsRecord.id;
        }
      }
    }

    if (!verified) {
      return Response.json({ error: "Invalid code. Please try again." }, { status: 400 });
    }

    if (smsOtpRecordId) {
      await prisma.mfaChallengeToken.delete({ where: { id: smsOtpRecordId } });
    }

    // Consume the pending token and issue a completion token (5 min TTL)
    await prisma.mfaChallengeToken.delete({ where: { id: challengeRecord.id } });

    const completionRecord = await prisma.mfaChallengeToken.create({
      data: {
        userId: session.mfaUserId,
        type: "completion",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    return Response.json({ completionToken: completionRecord.token });
  });
}
