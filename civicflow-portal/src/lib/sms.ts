export function isSmsConfigured() {
  return Boolean(process.env.SMS_PROVIDER && process.env.SMS_API_KEY && process.env.SMS_FROM_NUMBER);
}

type SendSmsResult = {
  sent: boolean;
  skipped: boolean;
  reason?: string;
  to: string;
  providerMessageId?: string;
};

export async function sendSms(input: { to: string; body: string }): Promise<SendSmsResult> {
  if (!isSmsConfigured()) {
    return {
      sent: false,
      skipped: true,
      reason: "SMS provider is not configured",
      to: input.to,
    };
  }

  const provider = process.env.SMS_PROVIDER;
  if (provider === "twilio") {
    return sendViaTwilio(input);
  }

  return {
    sent: false,
    skipped: true,
    reason: `Unsupported SMS_PROVIDER "${provider}"`,
    to: input.to,
  };
}

async function sendViaTwilio(input: { to: string; body: string }): Promise<SendSmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.SMS_API_KEY;
  const fromNumber = process.env.SMS_FROM_NUMBER;

  if (!accountSid) {
    return {
      sent: false,
      skipped: true,
      reason: "TWILIO_ACCOUNT_SID is not configured",
      to: input.to,
    };
  }

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const body = new URLSearchParams({ To: input.to, From: fromNumber ?? "", Body: input.body });

  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const payload = (await response.json().catch(() => null)) as { sid?: string; message?: string } | null;

    if (!response.ok) {
      return {
        sent: false,
        skipped: false,
        reason: payload?.message ?? `Twilio request failed (${response.status})`,
        to: input.to,
      };
    }

    return { sent: true, skipped: false, to: input.to, providerMessageId: payload?.sid };
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      reason: error instanceof Error ? error.message : "Unknown SMS send error",
      to: input.to,
    };
  }
}
