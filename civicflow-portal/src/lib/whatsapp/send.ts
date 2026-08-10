import { getEffectiveWhatsAppSender, getPlatformWhatsAppSettings } from "@/lib/whatsapp/credentials";
import { getServerEnv } from "@/lib/env";

type SendWhatsAppResult = {
  sent: boolean;
  skipped: boolean;
  reason?: string;
  to: string;
  providerMessageId?: string;
};

export interface WhatsAppSendInput {
  to: string; // E.164, no "whatsapp:" prefix — applied here, never trusted from a caller
  /** Approved-template send: Twilio Content SID + variables. Mutually exclusive with body. */
  contentSid?: string;
  contentVariables?: Record<string, string>;
  /** Freeform send — only valid within an open customer-service window, or against the Sandbox. Mutually exclusive with contentSid. */
  body?: string;
}

/** Whether we currently have enough Twilio credentials + a configured sender to attempt a send at all. */
export async function isWhatsAppConfigured(): Promise<boolean> {
  const sender = await getEffectiveWhatsAppSender();
  return Boolean(sender && (sender.fromNumber || sender.messagingServiceSid));
}

function buildStatusCallbackUrl(): string {
  return `${getServerEnv().NEXTAUTH_URL.replace(/\/+$/, "")}/api/webhooks/twilio/whatsapp/status`;
}

function toWhatsAppAddress(e164: string): string {
  return `whatsapp:${e164}`;
}

/**
 * Sends a single WhatsApp message via Twilio, gated by the platform-wide
 * controls in PlatformWhatsAppSettings mirroring sendSms()'s own gates:
 * disabled/maintenance/paused all stop every send; sandboxMode restricts
 * delivery to the configured test-number allowlist (mirrors SMS's Safe
 * Launch Mode) until a real WhatsApp Business Account is connected.
 */
export async function sendWhatsAppMessage(input: WhatsAppSendInput): Promise<SendWhatsAppResult> {
  if (Boolean(input.contentSid) === Boolean(input.body)) {
    throw new Error("sendWhatsAppMessage requires exactly one of contentSid or body.");
  }

  const [settings, sender] = await Promise.all([getPlatformWhatsAppSettings(), getEffectiveWhatsAppSender()]);

  if (!sender || (!sender.fromNumber && !sender.messagingServiceSid)) {
    return { sent: false, skipped: true, reason: "WhatsApp delivery is not configured", to: input.to };
  }

  if (!settings.platformEnabled) {
    return { sent: false, skipped: true, reason: "WhatsApp platform is currently disabled", to: input.to };
  }
  if (settings.maintenanceMode) {
    return { sent: false, skipped: true, reason: "WhatsApp is in maintenance mode", to: input.to };
  }
  if (settings.outboundPaused) {
    return { sent: false, skipped: true, reason: "Outbound WhatsApp is currently paused", to: input.to };
  }
  if (settings.sandboxMode && !settings.testPhoneNumbers.includes(input.to)) {
    return {
      sent: false,
      skipped: true,
      reason:
        "Sandbox mode: only verified test phone numbers can receive WhatsApp messages until a Business Account is connected",
      to: input.to,
    };
  }

  return sendViaTwilio(input, sender);
}

async function sendViaTwilio(
  input: WhatsAppSendInput,
  sender: NonNullable<Awaited<ReturnType<typeof getEffectiveWhatsAppSender>>>
): Promise<SendWhatsAppResult> {
  const { accountSid, authToken, messagingServiceSid, fromNumber } = sender;

  const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const body = new URLSearchParams({
    To: toWhatsAppAddress(input.to),
    StatusCallback: buildStatusCallbackUrl(),
  });
  if (messagingServiceSid) {
    body.set("MessagingServiceSid", messagingServiceSid);
  } else {
    body.set("From", toWhatsAppAddress(fromNumber ?? ""));
  }
  if (input.contentSid) {
    body.set("ContentSid", input.contentSid);
    if (input.contentVariables) {
      body.set("ContentVariables", JSON.stringify(input.contentVariables));
    }
  } else {
    body.set("Body", input.body ?? "");
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

    const payload = (await response.json().catch(() => null)) as { sid?: string; message?: string; code?: number } | null;

    if (!response.ok) {
      // No PII — status/code only, never phone numbers, message bodies, or template variables.
      console.error(
        JSON.stringify({
          event: "whatsapp_send_failed",
          status: response.status,
          providerCode: payload?.code ?? null,
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
        event: "whatsapp_send_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      })
    );
    return {
      sent: false,
      skipped: false,
      reason: error instanceof Error ? error.message : "Unknown WhatsApp send error",
      to: input.to,
    };
  }
}
