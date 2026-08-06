import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { getEffectiveTwilioCredentials } from "@/lib/sms-credentials";
import { verifyTwilioWebhookRequest } from "@/lib/twilio-signature";
import { bridgeInboundWhatsAppMessage } from "@/lib/whatsapp/inbox-bridge";
import { findMembersByWhatsAppPhone } from "@/lib/whatsapp/phone-matching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

const HELP_MESSAGE =
  "Unestra: For help, contact support@getunestra.com. Msg&data rates may apply. Reply STOP to unsubscribe.";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function messageTwiml(body: string): Response {
  const escaped = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`,
    { status: 200, headers: { "Content-Type": "text/xml" } }
  );
}

function twimlResponse() {
  return new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });
}

/**
 * Twilio inbound WhatsApp webhook — mirrors api/webhooks/twilio/inbound
 * (SMS), handling the same STOP/START/HELP compliance keywords, but against
 * OrgMember.whatsapp* fields instead of the SMS ones — WhatsApp opt-in/
 * opt-out is a separate consent from SMS, never inferred from it.
 *
 * Any other inbound content is bridged into the existing in-app Inbox via
 * bridgeInboundWhatsAppMessage() (src/lib/whatsapp/inbox-bridge.ts) — see
 * that module's doc comments for sender resolution and idempotency. A
 * sender with no OPTED_IN match is still acknowledged and dropped, exactly
 * as before.
 *
 * Sender resolution matches by whatsappPhoneNumber across all organizations
 * (the same platform-wide-scan shortcut the SMS webhook uses via `phone`) —
 * acceptable while every org shares one platform WhatsApp sender; revisit if
 * a future PR introduces per-organization senders, since then `To` should
 * disambiguate the organization instead.
 */
export async function POST(request: Request) {
  const rateLimited = await requireRateLimit({
    scope: "webhooks:twilio:whatsapp:inbound",
    request,
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const credentials = await getEffectiveTwilioCredentials();
  const paramsObject = await verifyTwilioWebhookRequest(request, credentials?.authToken);
  if (!paramsObject) {
    return new Response("Forbidden", { status: 403 });
  }

  const from = stripWhatsAppPrefix(paramsObject.From);
  const rawBody = (paramsObject.Body ?? "").trim();
  const body = rawBody.toUpperCase();
  const isKeyword = HELP_KEYWORDS.has(body) || STOP_KEYWORDS.has(body) || START_KEYWORDS.has(body);

  if (from && HELP_KEYWORDS.has(body)) {
    return messageTwiml(HELP_MESSAGE);
  }

  if (from && (STOP_KEYWORDS.has(body) || START_KEYWORDS.has(body))) {
    const matches = await findMembersByWhatsAppPhone(from);
    if (matches.length > 0) {
      const isStop = STOP_KEYWORDS.has(body);
      const now = new Date();
      const data = isStop
        ? { whatsappEnabled: false, whatsappOptedOutAt: now, whatsappOptInStatus: "OPTED_OUT" as const }
        : {
            whatsappEnabled: true,
            whatsappOptedOutAt: null,
            whatsappOptInStatus: "OPTED_IN" as const,
            whatsappLastConfirmedAt: now,
          };

      await prisma.orgMember.updateMany({ where: { id: { in: matches.map((m) => m.id) } }, data });

      await Promise.all(
        matches.map((member) =>
          createAuditEvent({
            organizationId: member.organizationId,
            action: isStop ? "whatsapp_consent.opt_out" : "whatsapp_consent.opt_in",
            entityType: "OrgMember",
            entityId: member.id,
            metadata: { source: "whatsapp_reply", keyword: body, phone: from },
          })
        )
      );
    }
  }

  // Any other content (not a compliance keyword) is bridged into the
  // existing in-app Inbox — see bridgeInboundWhatsAppMessage()'s doc
  // comment. No media handling (text-only, per the program's stated V1
  // scope) and no reply if there's no OPTED_IN member to attribute it to.
  if (from && rawBody && !isKeyword && paramsObject.MessageSid) {
    await bridgeInboundWhatsAppMessage({ from, body: rawBody, messageSid: paramsObject.MessageSid });
  }

  return twimlResponse();
}

function stripWhatsAppPrefix(value: string | undefined): string {
  return (value ?? "").replace(/^whatsapp:/i, "");
}
