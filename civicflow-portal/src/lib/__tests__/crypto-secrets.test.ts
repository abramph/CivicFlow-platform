import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto-secrets";

describe("crypto-secrets", () => {
  const originalKey = process.env.SMS_CREDENTIAL_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.SMS_CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  });

  afterEach(() => {
    process.env.SMS_CREDENTIAL_ENCRYPTION_KEY = originalKey;
  });

  it("round-trips a plaintext value through encrypt/decrypt", () => {
    const encrypted = encryptSecret("ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    expect(encrypted).not.toContain("ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    expect(decryptSecret(encrypted)).toBe("ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", () => {
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-value");
    expect(decryptSecret(b)).toBe("same-value");
  });

  it("throws when the encryption key is missing", () => {
    delete process.env.SMS_CREDENTIAL_ENCRYPTION_KEY;
    expect(() => encryptSecret("value")).toThrow(/SMS_CREDENTIAL_ENCRYPTION_KEY/);
  });

  it("throws when the encryption key isn't 32 bytes", () => {
    process.env.SMS_CREDENTIAL_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptSecret("value")).toThrow(/32 bytes/);
  });

  it("throws on decrypt with a wrong key (tamper/auth-tag detection)", () => {
    const encrypted = encryptSecret("value");
    process.env.SMS_CREDENTIAL_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    expect(() => decryptSecret(encrypted)).toThrow();
  });

  it("throws on an unrecognized stored format", () => {
    expect(() => decryptSecret("not-a-valid-format")).toThrow(/format/i);
  });

  it("masks a value, keeping only the last N characters visible", () => {
    expect(maskSecret("AC1234567890abcdef")).toBe("••••••••••••••cdef");
    expect(maskSecret("AC1234567890abcdef", 2)).toBe("••••••••••••••••ef");
  });

  it("masks a short value entirely when it's not longer than the visible suffix", () => {
    expect(maskSecret("abc", 4)).toBe("•••");
  });
});
