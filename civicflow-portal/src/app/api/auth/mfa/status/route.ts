import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId! },
    select: { mfaEnabled: true, mfaBackupCodes: true },
  });

  return Response.json({
    mfaEnabled: user?.mfaEnabled ?? false,
    backupCodesRemaining: user?.mfaBackupCodes.length ?? 0,
  });
}
