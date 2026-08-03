import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@/lib/prisma";
import { totpVerify } from "@/lib/totp";
import { withApiErrorHandling } from "@/lib/api-route";

export async function POST(req: Request) {
  return withApiErrorHandling(async () => {
    const session = await getServerSession(authOptions);
    if (!session?.userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const code = String(body.code ?? "").trim().replace(/\s/g, "");

    if (!code) {
      return Response.json({ error: "Code is required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId! },
      select: { mfaSecret: true, mfaEnabled: true },
    });

    if (user?.mfaEnabled) {
      return Response.json({ error: "MFA is already enabled" }, { status: 400 });
    }

    if (!user?.mfaSecret) {
      return Response.json(
        { error: "No pending MFA setup. Please start setup again." },
        { status: 400 }
      );
    }

    const isValid = totpVerify(code, user.mfaSecret);
    if (!isValid) {
      return Response.json({ error: "Invalid code. Please try again." }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: session.userId! },
      data: { mfaEnabled: true },
    });

    return Response.json({ ok: true });
  });
}
