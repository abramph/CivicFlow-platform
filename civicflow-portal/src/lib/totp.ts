import {
  generateSecret,
  generateSync,
  verifySync,
  generateURI,
} from "otplib";

export function totpGenerateSecret(): string {
  return generateSecret();
}

export function totpGenerate(secret: string): string {
  return generateSync({ secret });
}

export function totpVerify(token: string, secret: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = verifySync({ token, secret } as any);
  return result.valid;
}

export function totpKeyUri(label: string, issuer: string, secret: string): string {
  return generateURI({ secret, label, issuer });
}
