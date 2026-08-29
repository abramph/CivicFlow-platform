import crypto from "crypto";

function timingSafeBearerCompare(request: Request, secret: string): boolean {
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const authBuf = Buffer.from(auth);
  const expectedBuf = Buffer.from(expected);
  if (authBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(authBuf, expectedBuf);
}

/**
 * Bearer-auth check for scheduled /api/cron/* endpoints. Uses a timing-safe
 * comparison — same principle as the Twilio webhook signature check —
 * rather than `===`, which leaks how many leading bytes matched via
 * response-time differences.
 */
export function validateCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return timingSafeBearerCompare(request, secret);
}

/**
 * fix/report-export-queue-hardening: a secret dedicated ONLY to
 * /api/cron/reports, deliberately NOT accepted by any other cron route and
 * with NO fallback to the shared CRON_SECRET — pointing an external
 * scheduler at this one endpoint must never also hand it the ability to
 * trigger the other 11 (SMS sends, campaign blasts, import processing,
 * HOA/Union reminders, Meeting Intelligence submission/retention-deletion).
 * Fails closed exactly like validateCronSecret: absent env var means every
 * request is rejected, not "any request is accepted." Until
 * REPORT_EXPORT_CRON_SECRET is actually configured in the deployment
 * environment, this route is unreachable by design — that's the intended
 * state immediately after this hardening deploys, before a scheduler is
 * configured in a separate authorized step.
 */
export function validateReportExportCronSecret(request: Request): boolean {
  const secret = process.env.REPORT_EXPORT_CRON_SECRET;
  if (!secret) return false;
  return timingSafeBearerCompare(request, secret);
}
