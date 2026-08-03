import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/api-route";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  return withApiErrorHandling(async () => {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const password = String(body.password ?? "");

    if (!password) {
      return Response.json({ error: "Password is required to disable MFA" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId! },
      select: { passwordHash: true, mfaEnabled: true },
    });

    if (!user) return Response.json({ error: "User not found" }, { status: 404 });

    if (!user.mfaEnabled) {
      return Response.json({ error: "MFA is not enabled" }, { status: 400 });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return Response.json({ error: "Incorrect password" }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: session.userId! },
      data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [] },
    });

    // Revoke any outstanding challenge tokens for this user
    await prisma.mfaChallengeToken.deleteMany({ where: { userId: session.userId! } });

    return Response.json({ ok: true });
  });
}
