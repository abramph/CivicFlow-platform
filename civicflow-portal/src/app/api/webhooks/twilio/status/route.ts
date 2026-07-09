import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { getEffectiveTwilioCredentials } from "@/lib/sms-credentials";
import { verifyTwilioWebhookRequest } from "@/lib/twilio-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twimlResponse() {
  return new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });
}

const STATUS_MAP: Record<string, "QUEUED" | "SENDING" | "SENT" | "DELIVERED" | "FAILED"> = {
  queued: "QUEUED",
  sending: "SENDING",
  sent: "SENT",
  delivered: "DELIVERED",
  undelivered: "FAILED",
  failed: "FAILED",
};

/** Twilio sends Price as a negative decimal string (e.g. "-0.0079") — convert to a positive cent integer. */
function parsePriceCents(price: string | undefined): number | null {
  if (!price) return null;
  const dollars = Math.abs(Number.parseFloat(price));
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

/**
 * Twilio delivery-status webhook (StatusCallback) — set on every outbound
 * send by sendSms() (src/lib/sms.ts). Updates the matching SmsMessage's
 * status and, once Twilio reports a terminal status, its actualCostCents
 * (the real Twilio Price, distinct from costEstimateCents which is our
 * flat billing-time estimate). Not wired to real traffic until StatusCallback
 * URLs actually reach this route in production.
 */
export async function POST(request: Request) {
  const rateLimited = await requireRateLimit({
    scope: "webhooks:twilio:status",
    request,
    limit: 240,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const credentials = await getEffectiveTwilioCredentials();
  const params = await verifyTwilioWebhookRequest(request, credentials?.authToken);
  if (!params) {
    return new Response("Forbidden", { status: 403 });
  }

  const messageSid = params.MessageSid;
  const mappedStatus = STATUS_MAP[(params.MessageStatus ?? "").toLowerCase()];
  if (!messageSid || !mappedStatus) {
    return twimlResponse();
  }

  const costCents = parsePriceCents(params.Price);

  await prisma.smsMessage.updateMany({
    where: { providerMessageId: messageSid },
    data: {
      status: mappedStatus,
      ...(costCents !== null ? { actualCostCents: costCents } : {}),
      ...(mappedStatus === "FAILED" && params.ErrorMessage ? { errorMessage: params.ErrorMessage } : {}),
    },
  });

  return twimlResponse();
}
