import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@/lib/prisma";
import { totpGenerateSecret, totpKeyUri } from "@/lib/totp";
import QRCode from "qrcode";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = totpGenerateSecret();
  const email = session.userEmail ?? session.userId;
  const otpauthUrl = totpKeyUri(email, "CivicFlow", secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 200, margin: 2 });

  // Generate 8 backup codes (8 hex chars each)
  const backupCodes = Array.from({ length: 8 }, () =>
    randomBytes(4).toString("hex").toUpperCase()
  );
  const hashedBackupCodes = await Promise.all(
    backupCodes.map((code) => bcrypt.hash(code, 10))
  );

  // Persist secret + hashed backup codes; mfaEnabled stays false until confirmed
  await prisma.user.update({
    where: { id: session.userId! },
    data: { mfaSecret: secret, mfaBackupCodes: hashedBackupCodes },
  });

  return Response.json({ secret, qrCodeDataUrl, backupCodes });
}
