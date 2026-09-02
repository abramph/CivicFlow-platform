import { isValidEmail } from "@/lib/email";

/**
 * Security Patch A -- centralized SMTP header-injection hardening.
 * nodemailer's own advisories (SMTP command injection via
 * `envelope.size`, CRLF injection via transport-name/EHLO, and List-*
 * header comments) all stem from the same root cause: a caller-supplied
 * string reaching an SMTP command or header without being checked for
 * CR/LF/NUL first. This module is the single choke point every field that
 * becomes part of an outgoing message passes through, applied inside
 * sendEmail() itself (see mail.ts) so no caller can construct a message
 * that bypasses it.
 *
 * Rejects outright rather than stripping -- a caller that tried to inject
 * a header gets a clear error, not a silently "cleaned" message that
 * looks like it succeeded.
 */

export class MailHeaderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailHeaderValidationError";
  }
}

/** CR, LF, and NUL are the actual injection vectors (a header/command
 * terminates at CRLF; NUL truncates strings in some SMTP server
 * implementations). The full C0 control-character range is rejected too --
 * none of it belongs in an email header field, and rejecting the whole
 * range is simpler to reason about than trying to enumerate "the ones that
 * matter." Tab is allowed since folded header continuation lines
 * legitimately use it and nodemailer's own encoding handles it safely. */
const DISALLOWED_CONTROL_CHARS = /[\x00-\x08\x0A-\x1F]/;

function containsDisallowedControlChars(value: string): boolean {
  return DISALLOWED_CONTROL_CHARS.test(value);
}

/** Any plain header-ish value (subject, display name, filename) -- not
 * itself an email address. */
export function assertSafeHeaderValue(fieldName: string, value: string): void {
  if (containsDisallowedControlChars(value)) {
    throw new MailHeaderValidationError(`Invalid ${fieldName}: contains a disallowed character.`);
  }
}

/** An email address field (to/cc/bcc/reply-to/from). Checks both for
 * injection characters and for being a syntactically valid address --
 * redundant with callers that already validate via parseImportEmail()/
 * isValidEmail() upstream, deliberately, since this function is the one
 * point no caller can route around. */
export function assertSafeEmailAddress(fieldName: string, value: string): void {
  if (containsDisallowedControlChars(value)) {
    throw new MailHeaderValidationError(`Invalid ${fieldName}: contains a disallowed character.`);
  }
  if (!isValidEmail(value)) {
    throw new MailHeaderValidationError(`Invalid ${fieldName}: not a valid email address.`);
  }
}
