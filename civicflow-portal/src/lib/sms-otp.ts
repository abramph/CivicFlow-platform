import crypto from "crypto";

export { isValidE164Phone } from "@/lib/phone";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function generateOtpCode(): string {
  // 6 digits, zero-padded — a random int in [0, 999999].
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtpCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function otpExpiresAt(): Date {
  return new Date(Date.now() + OTP_TTL_MS);
}

/** "+15551234567" -> "+1•••••4567" — enough to recognize your own number, not enough to be useful to anyone else. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "•".repeat(digits.length);
  const last4 = digits.slice(-4);
  return `${"•".repeat(digits.length - 4)}${last4}`;
}
