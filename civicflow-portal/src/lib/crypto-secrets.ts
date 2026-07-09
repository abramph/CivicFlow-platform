import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended for GCM
const FORMAT_VERSION = "v1";

function getKey(): Buffer {
  const raw = process.env.SMS_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "SMS_CREDENTIAL_ENCRYPTION_KEY is not configured — cannot encrypt/decrypt stored SMS credentials."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SMS_CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).");
  }
  return key;
}

/** Encrypts a secret for storage (e.g. PlatformSmsSettings.accountSidEncrypted). Format: "v1:<iv>:<authTag>:<ciphertext>", each base64. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Reverses encryptSecret(). Throws if the key is missing/wrong or the ciphertext was tampered with. */
export function decryptSecret(stored: string): string {
  const key = getKey();
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error("Unrecognized encrypted-secret format.");
  }
  const [, ivB64, authTagB64, ciphertextB64] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

/** "AC1234567890abcdef" -> "•••••••••••••••cdef" — for display, never send the unmasked value to a client. */
export function maskSecret(value: string, visibleSuffix = 4): string {
  if (value.length <= visibleSuffix) return "•".repeat(value.length);
  return `${"•".repeat(value.length - visibleSuffix)}${value.slice(-visibleSuffix)}`;
}
