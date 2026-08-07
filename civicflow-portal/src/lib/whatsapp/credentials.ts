import type { PlatformWhatsAppSettings } from "@prisma/client";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto-secrets";
import { prisma } from "@/lib/prisma";
import { getEffectiveTwilioCredentials } from "@/lib/sms-credentials";

/**
 * Singleton row lookup — creates it on first access, mirroring
 * getPlatformSmsSettings(). Every reader/writer of platform WhatsApp
 * settings should go through this rather than querying
 * prisma.platformWhatsAppSettings directly.
 */
export async function getPlatformWhatsAppSettings(): Promise<PlatformWhatsAppSettings> {
  const existing = await prisma.platformWhatsAppSettings.findFirst();
  if (existing) return existing;
  return prisma.platformWhatsAppSettings.create({ data: {} });
}

export interface EffectiveWhatsAppSender {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string | null;
  fromNumber: string | null;
  /** Where the account credentials came from — see EffectiveTwilioCredentials.source in sms-credentials.ts. */
  credentialsSource: "database" | "env";
  /** Where the WhatsApp sender identity came from, independently of credentialsSource. */
  senderSource: "database" | "env" | "unconfigured";
}

/**
 * Resolves what sendWhatsAppMessage() needs to actually send: the Twilio
 * account credentials (reused as-is from the SMS integration —
 * getEffectiveTwilioCredentials() in sms-credentials.ts; WhatsApp is not a
 * separate Twilio account) combined with the WhatsApp-specific sender
 * identity (this table's fromNumber/messagingServiceSid, database-first,
 * falling back to WHATSAPP_SANDBOX_FROM_NUMBER so a send can work before any
 * admin UI exists — same bootstrap property SMS_FROM_NUMBER has today).
 * Returns null only if there are no account credentials at all; a missing
 * sender identity still returns a result with fromNumber/messagingServiceSid
 * null, since the caller (sendWhatsAppMessage) has its own clear error for that.
 */
export async function getEffectiveWhatsAppSender(): Promise<EffectiveWhatsAppSender | null> {
  const accountCredentials = await getEffectiveTwilioCredentials();
  if (!accountCredentials) return null;

  const settings = await getPlatformWhatsAppSettings();

  if (settings.fromNumberEncrypted || settings.messagingServiceSidEncrypted) {
    return {
      accountSid: accountCredentials.accountSid,
      authToken: accountCredentials.authToken,
      messagingServiceSid: settings.messagingServiceSidEncrypted
        ? decryptSecret(settings.messagingServiceSidEncrypted)
        : null,
      fromNumber: settings.fromNumberEncrypted ? decryptSecret(settings.fromNumberEncrypted) : null,
      credentialsSource: accountCredentials.source,
      senderSource: "database",
    };
  }

  const envFromNumber = process.env.WHATSAPP_SANDBOX_FROM_NUMBER ?? null;
  return {
    accountSid: accountCredentials.accountSid,
    authToken: accountCredentials.authToken,
    messagingServiceSid: null,
    fromNumber: envFromNumber,
    credentialsSource: accountCredentials.source,
    senderSource: envFromNumber ? "env" : "unconfigured",
  };
}

export interface UpdatePlatformWhatsAppSettingsInput {
  fromNumber?: string | null;
  messagingServiceSid?: string | null;
  platformEnabled?: boolean;
  sandboxMode?: boolean;
  maintenanceMode?: boolean;
  outboundPaused?: boolean;
  orgMessagingEnabled?: boolean;
  testPhoneNumbers?: string[];
}

const SENDER_FIELD_MAP = {
  fromNumber: "fromNumberEncrypted",
  messagingServiceSid: "messagingServiceSidEncrypted",
} as const;

const TOGGLE_FIELDS = ["platformEnabled", "sandboxMode", "maintenanceMode", "outboundPaused", "orgMessagingEnabled"] as const;

/**
 * Encrypts and saves the WhatsApp sender identity, and/or updates the
 * platform-wide global-control toggles and Safe-Launch test numbers — the
 * WhatsApp Administration UI's one write path (PR D). Pass null to clear a
 * sender field; omit any field to leave it unchanged. Never returns
 * plaintext.
 */
export async function updatePlatformWhatsAppSettings(
  input: UpdatePlatformWhatsAppSettingsInput,
  userId: string
): Promise<void> {
  const settings = await getPlatformWhatsAppSettings();
  const data: Record<string, string | null | boolean | string[]> = { updatedByUserId: userId };

  for (const [plainKey, encryptedKey] of Object.entries(SENDER_FIELD_MAP)) {
    const value = input[plainKey as keyof UpdatePlatformWhatsAppSettingsInput];
    if (value === undefined) continue;
    data[encryptedKey] = value ? encryptSecret(value as string) : null;
  }

  for (const key of TOGGLE_FIELDS) {
    const value = input[key];
    if (value !== undefined) data[key] = value;
  }

  if (input.testPhoneNumbers !== undefined) data.testPhoneNumbers = input.testPhoneNumbers;

  await prisma.platformWhatsAppSettings.update({ where: { id: settings.id }, data });
}

export interface MaskedWhatsAppSettingsView {
  fromNumber: string | null; // shown in full — an identifier, not a secret
  messagingServiceSid: string | null; // shown in full
  accountSidMasked: string | null; // reused from SMS credentials, masked
  senderSource: "database" | "env" | "unconfigured";
  platformEnabled: boolean;
  sandboxMode: boolean;
  maintenanceMode: boolean;
  outboundPaused: boolean;
  orgMessagingEnabled: boolean;
  testPhoneNumbers: string[];
}

/** Decrypts server-side only to build display-safe values for the WhatsApp Administration UI (PR D) — raw secrets never reach the client. */
export async function getMaskedWhatsAppSettingsView(): Promise<MaskedWhatsAppSettingsView> {
  const [settings, sender] = await Promise.all([getPlatformWhatsAppSettings(), getEffectiveWhatsAppSender()]);

  return {
    fromNumber: sender?.fromNumber ?? null,
    messagingServiceSid: sender?.messagingServiceSid ?? null,
    accountSidMasked: sender ? maskSecret(sender.accountSid) : null,
    senderSource: sender?.senderSource ?? "unconfigured",
    platformEnabled: settings.platformEnabled,
    sandboxMode: settings.sandboxMode,
    maintenanceMode: settings.maintenanceMode,
    outboundPaused: settings.outboundPaused,
    orgMessagingEnabled: settings.orgMessagingEnabled,
    testPhoneNumbers: settings.testPhoneNumbers,
  };
}
