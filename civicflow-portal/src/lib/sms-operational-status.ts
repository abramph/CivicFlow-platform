import { getEffectiveTwilioCredentials, getPlatformSmsSettings } from "@/lib/sms-credentials";

/**
 * The canonical PLATFORM-level SMS operational gate — the switches that live in
 * PlatformSmsSettings and gate every send regardless of any single org's
 * entitlement. Historically these were enforced ONLY deep inside sendSms()
 * (src/lib/sms.ts), so a caller that consulted getSmsEntitlement() alone (e.g.
 * the mobile composer capability) could believe SMS was available when a
 * platform-wide disable / maintenance / pause / missing-credentials condition
 * would in fact block every send. This module is the single source of truth for
 * those switches, shared by sendSms() and the mobile capability so they can
 * never diverge.
 *
 * NOT included here: per-recipient Safe Launch allowlisting (testMode +
 * testPhoneNumbers). That is recipient-specific and only knowable once an
 * audience is resolved, so it is surfaced as the `testMode` flag (a "restricted
 * mode", not an outright block) and still enforced per-number inside sendSms().
 */
export type SmsPlatformUnavailableCode = "NOT_CONFIGURED" | "PLATFORM_DISABLED" | "MAINTENANCE" | "OUTBOUND_PAUSED";

export interface SmsPlatformStatus {
  /** Twilio credentials + a sender (from-number or messaging service) present. */
  configured: boolean;
  /** True when the platform-wide switches permit sending at all. */
  available: boolean;
  /** Set iff available === false. */
  unavailableCode?: SmsPlatformUnavailableCode;
  /** Exact operator-facing reason (matches sendSms()'s wording). */
  reason?: string;
  /** Safe Launch Mode active — sends are restricted to the test allowlist. */
  testMode: boolean;
}

/** Pure evaluation of the platform switches — unit-testable without a database.
 *  The check order and reason strings mirror sendSms() exactly. */
export function evaluateSmsPlatformStatus(
  settings: { platformEnabled: boolean; maintenanceMode: boolean; outboundPaused: boolean; testMode: boolean },
  credentials: { fromNumber?: string | null; messagingServiceSid?: string | null } | null
): SmsPlatformStatus {
  const testMode = settings.testMode;
  const configured = Boolean(credentials && (credentials.fromNumber || credentials.messagingServiceSid));
  if (!configured) {
    return { configured: false, available: false, unavailableCode: "NOT_CONFIGURED", reason: "SMS delivery is not configured", testMode };
  }
  if (!settings.platformEnabled) {
    return { configured, available: false, unavailableCode: "PLATFORM_DISABLED", reason: "SMS platform is currently disabled", testMode };
  }
  if (settings.maintenanceMode) {
    return { configured, available: false, unavailableCode: "MAINTENANCE", reason: "SMS is in maintenance mode", testMode };
  }
  if (settings.outboundPaused) {
    return { configured, available: false, unavailableCode: "OUTBOUND_PAUSED", reason: "Outbound SMS is currently paused", testMode };
  }
  return { configured, available: true, testMode };
}

/** Reads live platform settings + credentials and evaluates the gate. */
export async function getSmsPlatformStatus(): Promise<SmsPlatformStatus> {
  const [settings, credentials] = await Promise.all([getPlatformSmsSettings(), getEffectiveTwilioCredentials()]);
  return evaluateSmsPlatformStatus(settings, credentials);
}
