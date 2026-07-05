const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export function isValidE164Phone(phone: string): boolean {
  return E164_PATTERN.test(phone.trim());
}
