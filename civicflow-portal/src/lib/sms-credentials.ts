import type { PlatformSmsSettings } from "@prisma/client";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto-secrets";
import { prisma } from "@/lib/prisma";

/**
 * Singleton row lookup — creates it on first access rather than requiring a
 * seed/migration step. Every reader/writer of platform SMS settings should
 * go through this (or updatePlatformSmsCredentials/updatePlatformSmsToggles)
 * rather than querying prisma.platformSmsSettings directly.
 */
export async function getPlatformSmsSettings(): Promise<PlatformSmsSettings> {
  const existing = await prisma.platformSmsSettings.findFirst();
  if (existing) return existing;
  return prisma.platformSmsSettings.create({ data: {} });
}

export interface EffectiveTwilioCredentials {
  accountSid: string;
  authToken: string;
  apiKey: string | null;
  apiSecret: string | null;
  messagingServiceSid: string | null;
  fromNumber: string | null;
  /** Where these credentials came from — "database" once an admin has configured them via /admin/platform/sms, "env" while relying on the legacy flat env vars. */
  source: "database" | "env";
}

/**
 * Resolves the Twilio credentials sendSms() should actually use: database
 * (encrypted, admin-configured via the SMS Administration module) first,
 * falling back to the legacy TWILIO_ACCOUNT_SID/SMS_API_KEY/SMS_FROM_NUMBER
 * env vars if nothing has been configured in the database yet. This lets
 * existing SMS traffic (and every existing test that mocks those env vars)
 * keep working unchanged through the migration to DB-stored credentials —
 * no flag-day cutover required.
 */
export async function getEffectiveTwilioCredentials(): Promise<EffectiveTwilioCredentials | null> {
  const settings = await getPlatformSmsSettings();

  if (settings.accountSidEncrypted && settings.authTokenEncrypted) {
    return {
      accountSid: decryptSecret(settings.accountSidEncrypted),
      authToken: decryptSecret(settings.authTokenEncrypted),
      apiKey: settings.apiKeyEncrypted ? decryptSecret(settings.apiKeyEncrypted) : null,
      apiSecret: settings.apiSecretEncrypted ? decryptSecret(settings.apiSecretEncrypted) : null,
      messagingServiceSid: settings.messagingServiceSidEncrypted
        ? decryptSecret(settings.messagingServiceSidEncrypted)
        : null,
      fromNumber: settings.tollFreeNumberEncrypted ? decryptSecret(settings.tollFreeNumberEncrypted) : null,
      source: "database",
    };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.SMS_API_KEY;
  if (!accountSid || !authToken) return null;

  return {
    accountSid,
    authToken,
    apiKey: null,
    apiSecret: null,
    messagingServiceSid: null,
    fromNumber: process.env.SMS_FROM_NUMBER ?? null,
    source: "env",
  };
}

export interface UpdatePlatformSmsCredentialsInput {
  accountSid?: string | null;
  authToken?: string | null;
  apiKey?: string | null;
  apiSecret?: string | null;
  messagingServiceSid?: string | null;
  tollFreeNumber?: string | null;
  verifyServiceSid?: string | null;
}

const CREDENTIAL_FIELD_MAP = {
  accountSid: "accountSidEncrypted",
  authToken: "authTokenEncrypted",
  apiKey: "apiKeyEncrypted",
  apiSecret: "apiSecretEncrypted",
  messagingServiceSid: "messagingServiceSidEncrypted",
  tollFreeNumber: "tollFreeNumberEncrypted",
  verifyServiceSid: "verifyServiceSidEncrypted",
} as const;

/** Encrypts and saves any provided credential fields. Pass null to clear a field; omit to leave it unchanged. Never returns plaintext. */
export async function updatePlatformSmsCredentials(
  input: UpdatePlatformSmsCredentialsInput,
  userId: string
): Promise<void> {
  const settings = await getPlatformSmsSettings();
  const data: Record<string, string | null> = { updatedByUserId: userId };

  for (const [plainKey, encryptedKey] of Object.entries(CREDENTIAL_FIELD_MAP)) {
    const value = input[plainKey as keyof UpdatePlatformSmsCredentialsInput];
    if (value === undefined) continue;
    data[encryptedKey] = value ? encryptSecret(value) : null;
  }

  await prisma.platformSmsSettings.update({ where: { id: settings.id }, data });
}

export interface MaskedSmsCredentialsView {
  accountSid: string | null; // masked, last 4 visible
  apiKey: string | null; // masked, last 4 visible
  authTokenConfigured: boolean; // never shown, even masked
  apiSecretConfigured: boolean; // never shown, even masked
  messagingServiceSid: string | null; // shown in full — an identifier, not a secret
  tollFreeNumber: string | null; // shown in full
  verifyServiceSidConfigured: boolean;
  source: "database" | "env" | "unconfigured";
}

/** Decrypts server-side only to build display-safe masked values — raw secrets never reach the client. */
export async function getMaskedSmsCredentialsView(): Promise<MaskedSmsCredentialsView> {
  const settings = await getPlatformSmsSettings();

  if (settings.accountSidEncrypted) {
    return {
      accountSid: maskSecret(decryptSecret(settings.accountSidEncrypted)),
      apiKey: settings.apiKeyEncrypted ? maskSecret(decryptSecret(settings.apiKeyEncrypted)) : null,
      authTokenConfigured: Boolean(settings.authTokenEncrypted),
      apiSecretConfigured: Boolean(settings.apiSecretEncrypted),
      messagingServiceSid: settings.messagingServiceSidEncrypted
        ? decryptSecret(settings.messagingServiceSidEncrypted)
        : null,
      tollFreeNumber: settings.tollFreeNumberEncrypted ? decryptSecret(settings.tollFreeNumberEncrypted) : null,
      verifyServiceSidConfigured: Boolean(settings.verifyServiceSidEncrypted),
      source: "database",
    };
  }

  const envConfigured = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.SMS_API_KEY);
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID ? maskSecret(process.env.TWILIO_ACCOUNT_SID) : null,
    apiKey: null,
    authTokenConfigured: Boolean(process.env.SMS_API_KEY),
    apiSecretConfigured: false,
    messagingServiceSid: null,
    tollFreeNumber: process.env.SMS_FROM_NUMBER ?? null,
    verifyServiceSidConfigured: false,
    source: envConfigured ? "env" : "unconfigured",
  };
}
