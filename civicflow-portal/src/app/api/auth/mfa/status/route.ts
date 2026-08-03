import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@/lib/prisma";
import { maskPhone } from "@/lib/sms-otp";
import { withApiErrorHandling } from "@/lib/api-route";

export async function GET() {
  return withApiErrorHandling(async () => {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId! },
      select: { mfaEnabled: true, mfaBackupCodes: true, phone: true, phoneVerified: true },
    });

    return Response.json({
      mfaEnabled: user?.mfaEnabled ?? false,
      backupCodesRemaining: user?.mfaBackupCodes.length ?? 0,
      phoneVerified: user?.phoneVerified ?? false,
      maskedPhone: user?.phone && user.phoneVerified ? maskPhone(user.phone) : null,
    });
  });
}
