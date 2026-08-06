import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { getEffectiveTwilioCredentials } from "@/lib/sms-credentials";
import { verifyTwilioWebhookRequest } from "@/lib/twilio-signature";
import type { WhatsAppMessageStatus } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twimlResponse() {
  return new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });
}

const STATUS_MAP: Record<string, WhatsAppMessageStatus> = {
  queued: "QUEUED",
  sending: "SENDING",
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  undelivered: "UNDELIVERED",
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
 * Twilio WhatsApp delivery-status webhook (StatusCallback) — set on every
 * outbound send by sendWhatsAppMessage() (src/lib/whatsapp/send.ts). Mirrors
 * the SMS status webhook (api/webhooks/twilio/status) with two additional
 * terminal states WhatsApp reports that SMS never does: READ and
 * UNDELIVERED (see WhatsAppMessageStatus doc in schema.prisma). Not wired to
 * real traffic until this URL is the sender's configured Status Callback in
 * the Twilio console, and reachable only once a WhatsApp send has actually
 * gone out (Sandbox or a real WABA sender).
 */
export async function POST(request: Request) {
  const rateLimited = await requireRateLimit({
    scope: "webhooks:twilio:whatsapp:status",
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
  const now = new Date();
  const isFailure = mappedStatus === "FAILED" || mappedStatus === "UNDELIVERED";

  await prisma.whatsAppMessage.updateMany({
    where: { providerMessageId: messageSid },
    data: {
      status: mappedStatus,
      ...(costCents !== null ? { actualCostCents: costCents } : {}),
      ...(mappedStatus === "DELIVERED" ? { deliveredAt: now } : {}),
      ...(mappedStatus === "READ" ? { readAt: now } : {}),
      ...(isFailure ? { failedAt: now } : {}),
      ...(isFailure && params.ErrorCode ? { errorCode: params.ErrorCode } : {}),
      ...(isFailure && params.ErrorMessage ? { errorMessage: params.ErrorMessage } : {}),
    },
  });

  return twimlResponse();
}
