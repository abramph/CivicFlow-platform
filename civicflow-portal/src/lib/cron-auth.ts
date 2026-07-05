import crypto from "crypto";

/**
 * Bearer-auth check for scheduled /api/cron/* endpoints. Uses a timing-safe
 * comparison — same principle as the Twilio webhook signature check —
 * rather than `===`, which leaks how many leading bytes matched via
 * response-time differences.
 */
export function validateCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const authBuf = Buffer.from(auth);
  const expectedBuf = Buffer.from(expected);
  if (authBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(authBuf, expectedBuf);
}
