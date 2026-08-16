import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_EXPIRY_MS = 30 * 60 * 1000;           // 30 minutes
const ACCOUNT_DELETION_EXPIRY_MS = 30 * 60 * 1000;         // 30 minutes — irreversible action, short-lived like a password reset

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function createEmailVerificationToken(userId: string): Promise<string> {
  const token = generateToken();
  await prisma.accountVerificationToken.deleteMany({
    where: { userId, type: "email_verification", usedAt: null },
  });
  await prisma.accountVerificationToken.create({
    data: {
      userId,
      token,
      type: "email_verification",
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS),
    },
  });
  return token;
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = generateToken();
  await prisma.accountVerificationToken.deleteMany({
    where: { userId, type: "password_reset", usedAt: null },
  });
  await prisma.accountVerificationToken.create({
    data: {
      userId,
      token,
      type: "password_reset",
      expiresAt: new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS),
    },
  });
  return token;
}

export async function createAccountDeletionToken(userId: string): Promise<string> {
  const token = generateToken();
  await prisma.accountVerificationToken.deleteMany({
    where: { userId, type: "account_deletion", usedAt: null },
  });
  await prisma.accountVerificationToken.create({
    data: {
      userId,
      token,
      type: "account_deletion",
      expiresAt: new Date(Date.now() + ACCOUNT_DELETION_EXPIRY_MS),
    },
  });
  return token;
}

export async function consumeToken(
  token: string,
  type: "email_verification" | "password_reset" | "account_deletion"
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const record = await prisma.accountVerificationToken.findUnique({ where: { token } });
  if (!record || record.type !== type) return { ok: false, error: "Invalid or expired link." };
  if (record.usedAt) return { ok: false, error: "This link has already been used." };
  if (record.expiresAt < new Date()) return { ok: false, error: "This link has expired. Request a new one." };

  await prisma.accountVerificationToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });
  return { ok: true, userId: record.userId };
}
