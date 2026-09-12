import { getEffectiveTwilioCredentials, getPlatformSmsSettings } from "@/lib/sms-credentials";
import { getServerEnv } from "@/lib/env";

/**
 * Discriminated provider outcome (Round 5):
 *  - "sent": Twilio returned a successful acceptance (with the message SID).
 *  - "definitive_failure": the request was never attempted (a platform gate
 *    blocked it) or Twilio returned a definite non-success HTTP response —
 *    the message provably did not go out, so quota may be released.
 *  - "unknown": the request may have been dispatched but acceptance cannot
 *    be proven either way — timeout/abort, connection reset, or any other
 *    thrown transport error. Twilio may have accepted it while the response
 *    was lost, so callers must NOT release quota and must NOT automatically
 *    retry (a retry could duplicate the text); the attempt is preserved for
 *    manual reconciliation against the Twilio Console. Twilio's Messages
 *    create API offers no idempotency key we could verify from its
 *    documentation, so retry-with-dedupe is not an option.
 *
 * `sent`/`skipped` booleans are retained for the transactional callers
 * (MFA/verification codes) that only need a coarse did-it-go signal;
 * `sent === true` iff `outcome === "sent"`.
 */
export type SmsProviderOutcome = "sent" | "definitive_failure" | "unknown";

type SendSmsResult = {
  sent: boolean;
  skipped: boolean;
  outcome: SmsProviderOutcome;
  reason?: string;
  to: string;
  providerMessageId?: string;
};

/**
 * Hard ceiling on the Twilio HTTP request. Node's fetch (undici) has NO
 * usable default here — its headers/body timeouts are 300s — so without
 * this, a hung Twilio call could outlive the retry lease
 * (SMS_RETRY_LEASE_MS in lib/sms-queue.ts, 120s) and a recovery worker
 * could double-send. This value MUST stay comfortably below that lease
 * (4x margin today; asserted by sms-queue.test.ts). A timeout aborts the
 * fetch and lands in the same catch as any thrown transport error — which
 * reports outcome "unknown" (NOT a failure): the request may have been
 * accepted while the response was lost, so callers park the attempt for
 * manual reconciliation instead of releasing quota or retrying.
 */
export const TWILIO_REQUEST_TIMEOUT_MS = 30_000;

/** Whether we currently have enough Twilio credentials (database or env-var) to attempt a send at all — not a check of the platform enable/pause/test-mode gates in sendSms() itself. */
export async function isSmsConfigured(): Promise<boolean> {
  const credentials = await getEffectiveTwilioCredentials();
  return Boolean(credentials && (credentials.fromNumber || credentials.messagingServiceSid));
}

function buildStatusCallbackUrl(): string {
  return `${getServerEnv().NEXTAUTH_URL.replace(/\/+$/, "")}/api/webhooks/twilio/status`;
}

/**
 * Sends a single SMS via Twilio, gated by the platform-wide controls in
 * PlatformSmsSettings (src/app/admin/platform/sms): disabled/maintenance/
 * paused all stop every send; test mode restricts delivery to the
 * configured test-number allowlist (Safe Launch Mode, for while the toll-free
 * number is still pending carrier verification). Credentials resolve
 * database-first, env-var-fallback — see getEffectiveTwilioCredentials().
 */
export async function sendSms(input: { to: string; body: string }): Promise<SendSmsResult> {
  const [settings, credentials] = await Promise.all([getPlatformSmsSettings(), getEffectiveTwilioCredentials()]);

  if (!credentials || (!credentials.fromNumber && !credentials.messagingServiceSid)) {
    return { sent: false, skipped: true, outcome: "definitive_failure", reason: "SMS delivery is not configured", to: input.to };
  }

  if (!settings.platformEnabled) {
    return { sent: false, skipped: true, outcome: "definitive_failure", reason: "SMS platform is currently disabled", to: input.to };
  }
  if (settings.maintenanceMode) {
    return { sent: false, skipped: true, outcome: "definitive_failure", reason: "SMS is in maintenance mode", to: input.to };
  }
  if (settings.outboundPaused) {
    return { sent: false, skipped: true, outcome: "definitive_failure", reason: "Outbound SMS is currently paused", to: input.to };
  }
  if (settings.testMode && !settings.testPhoneNumbers.includes(input.to)) {
    return {
      sent: false,
      skipped: true,
      outcome: "definitive_failure",
      reason: "Safe Launch Mode: only verified test phone numbers can receive SMS until toll-free verification is complete",
      to: input.to,
    };
  }

  return sendViaTwilio(input, credentials);
}

async function sendViaTwilio(
  input: { to: string; body: string },
  credentials: NonNullable<Awaited<ReturnType<typeof getEffectiveTwilioCredentials>>>
): Promise<SendSmsResult> {
  const { accountSid, authToken, apiKey, apiSecret, messagingServiceSid, fromNumber } = credentials;

  // Prefer a scoped API Key/Secret over the account-wide Auth Token when
  // both are configured -- least privilege, independently revocable. The
  // account SID in the request path is always the account SID regardless
  // of which credential authenticates the request.
  const basicAuthUser = apiKey && apiSecret ? apiKey : accountSid;
  const basicAuthPass = apiKey && apiSecret ? apiSecret : authToken;
  const basicAuth = Buffer.from(`${basicAuthUser}:${basicAuthPass}`).toString("base64");
  const body = new URLSearchParams({ To: input.to, Body: input.body, StatusCallback: buildStatusCallbackUrl() });
  if (messagingServiceSid) {
    body.set("MessagingServiceSid", messagingServiceSid);
  } else {
    body.set("From", fromNumber ?? "");
  }

  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(TWILIO_REQUEST_TIMEOUT_MS),
    });

    const payload = (await response.json().catch(() => null)) as { sid?: string; message?: string; code?: number } | null;

    if (!response.ok) {
      // No PII — status/code only, never phone numbers or the message body.
      console.error(
        JSON.stringify({
          event: "sms_send_failed",
          status: response.status,
          providerCode: payload?.code ?? null,
        })
      );
      // Twilio answered with a definite non-success — the message provably
      // was not accepted, so this is a releasable failure.
      return {
        sent: false,
        skipped: false,
        outcome: "definitive_failure",
        reason: payload?.message ?? `Twilio request failed (${response.status})`,
        to: input.to,
      };
    }

    // A 2xx alone does not prove acceptance we can reconcile: without a
    // valid message SID there is no provider identity to match a delivery
    // callback or a Twilio Console lookup against. Malformed JSON, a null
    // payload, or an absent/blank/invalid SID on a "successful" response is
    // therefore an AMBIGUOUS outcome — the message may well be on its way —
    // never a SENT commit and never a releasable failure. Twilio message
    // SIDs are "SM" + 32 hex chars.
    const sid = payload?.sid;
    if (typeof sid !== "string" || !/^SM[0-9a-fA-F]{32}$/.test(sid)) {
      // No PII — HTTP status and a coarse cause only.
      console.error(
        JSON.stringify({
          event: "sms_send_outcome_unknown",
          status: response.status,
          cause: "missing_or_invalid_message_sid",
        })
      );
      return {
        sent: false,
        skipped: false,
        outcome: "unknown",
        reason: "Delivery outcome is unknown; verify in Twilio before retrying.",
        to: input.to,
      };
    }

    return { sent: true, skipped: false, outcome: "sent", to: input.to, providerMessageId: sid };
  } catch (error) {
    // Thrown transport errors (abort/timeout, connection reset, DNS/socket
    // failures) prove nothing about whether Twilio accepted the request —
    // the response may simply have been lost after acceptance. Never
    // described as a provider rejection; callers must treat this as an
    // ambiguous outcome (no quota release, no automatic retry). No PII in
    // the log — error name only, never the number or body.
    console.error(
      JSON.stringify({
        event: "sms_send_outcome_unknown",
        errorName: error instanceof Error ? error.name : "UnknownError",
      })
    );
    return {
      sent: false,
      skipped: false,
      outcome: "unknown",
      reason: "Delivery outcome is unknown; verify in Twilio before retrying.",
      to: input.to,
    };
  }
}
