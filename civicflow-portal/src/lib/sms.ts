export function isSmsConfigured() {
  return Boolean(process.env.SMS_PROVIDER && process.env.SMS_API_KEY && process.env.SMS_FROM_NUMBER);
}

export async function sendSms(input: { to: string; body: string }) {
  if (!isSmsConfigured()) {
    return {
      sent: false,
      skipped: true,
      reason: "SMS provider is not configured",
      to: input.to,
    };
  }

  return {
    sent: false,
    skipped: true,
    reason: "SMS provider adapter is not implemented",
    to: input.to,
  };
}
