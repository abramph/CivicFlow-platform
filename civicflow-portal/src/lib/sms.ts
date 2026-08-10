import { getEffectiveTwilioCredentials, getPlatformSmsSettings } from "@/lib/sms-credentials";
import { getServerEnv } from "@/lib/env";
import { maskPhone } from "@/lib/sms-otp";

type SendSmsResult = {
  sent: boolean;
  skipped: boolean;
  reason?: string;
  to: string;
  providerMessageId?: string;
};

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
    return { sent: false, skipped: true, reason: "SMS delivery is not configured", to: input.to };
  }

  if (!settings.platformEnabled) {
    return { sent: false, skipped: true, reason: "SMS platform is currently disabled", to: input.to };
  }
  if (settings.maintenanceMode) {
    return { sent: false, skipped: true, reason: "SMS is in maintenance mode", to: input.to };
  }
  if (settings.outboundPaused) {
    return { sent: false, skipped: true, reason: "Outbound SMS is currently paused", to: input.to };
  }
  if (settings.testMode && !settings.testPhoneNumbers.includes(input.to)) {
    return {
      sent: false,
      skipped: true,
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
  const { accountSid, authToken, messagingServiceSid, fromNumber } = credentials;

  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
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
    });

    const payload = (await response.json().catch(() => null)) as { sid?: string; message?: string } | null;

    if (!response.ok) {
      // No PII — masked phone, provider status code/message only, never the message body.
      console.error(
        JSON.stringify({
          event: "sms_send_failed",
          to: maskPhone(input.to),
          status: response.status,
          providerMessage: payload?.message ?? null,
        })
      );
      return {
        sent: false,
        skipped: false,
        reason: payload?.message ?? `Twilio request failed (${response.status})`,
        to: input.to,
      };
    }

    return { sent: true, skipped: false, to: input.to, providerMessageId: payload?.sid };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "sms_send_failed",
        to: maskPhone(input.to),
        error: error instanceof Error ? error.message : "Unknown SMS send error",
      })
    );
    return {
      sent: false,
      skipped: false,
      reason: error instanceof Error ? error.message : "Unknown SMS send error",
      to: input.to,
    };
  }
}
