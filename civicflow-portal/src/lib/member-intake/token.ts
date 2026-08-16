import crypto from "crypto";

/**
 * Member Intake & Profile Update (MEMBER-QR-A) — public, long-lived tokens
 * for form links and QR-campaign sources. Deliberately NOT the same cuid()
 * generator used for ordinary primary keys (not designed to resist
 * guessing) and deliberately NOT a signed/short-lived JWT like
 * attendance-token.ts (that pattern solves a different problem — a
 * time-boxed scan window — whereas these links are meant to stay valid for
 * weeks or months, printed on physical flyers). A plain, sufficiently long
 * random string looked up directly in the database is the right shape here,
 * same spirit as /give/[slug] but random rather than human-chosen since the
 * URL alone must not suggest which organization it belongs to.
 */
export function generateIntakeToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}
