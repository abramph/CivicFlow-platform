const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export function isValidE164Phone(phone: string): boolean {
  return E164_PATTERN.test(phone.trim());
}

/**
 * Normalizes a loosely-formatted phone number — as entered on member
 * records via manual entry or CSV import, e.g. "215-917-4391" — into
 * E.164 so it can be sent through Twilio. Assumes North American
 * numbering (+1) when no country code is present, since member phone
 * fields predate any country-code field. Returns null if it can't
 * produce a plausible E.164 number.
 */
export function normalizeToE164(phone: string): string | null {
  const trimmed = phone.trim();
  if (isValidE164Phone(trimmed)) return trimmed;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
