import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { findMembersByPhone } from "@/lib/sms-phone-matching";
import { getEffectiveTwilioCredentials } from "@/lib/sms-credentials";
import { verifyTwilioWebhookRequest } from "@/lib/twilio-signature";

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
 * Twilio inbound SMS webhook — handles STOP/START/HELP compliance keywords.
 * Not wired to real traffic until this URL is configured as the phone
 * number's "A Message Comes In" webhook in the Twilio console (see
 * docs/sms-setup.md). Twilio also has its own carrier-level STOP handling
 * (Advanced Opt-Out) — this is a second, application-level layer so we never
 * queue a new send to an opted-out member even if that's misconfigured.
 * Every STOP/START match writes an AuditEvent per matched member, alongside
 * the OrgMember row update, so the SMS consent audit trail (src/lib/sms-consent.ts)
 * covers opt-outs/re-opt-ins that happen by text reply, not just in-app.
 * Signature verification resolves credentials database-first, env-fallback
 * via getEffectiveTwilioCredentials() — see src/lib/sms-credentials.ts.
 */
export async function POST(request: Request) {
  const rateLimited = await requireRateLimit({
    scope: "webhooks:twilio:inbound",
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

  const from = paramsObject.From;
  const body = (paramsObject.Body ?? "").trim().toUpperCase();

  if (from && HELP_KEYWORDS.has(body)) {
    return messageTwiml(HELP_MESSAGE);
  }

  if (from && (STOP_KEYWORDS.has(body) || START_KEYWORDS.has(body))) {
    const matches = await findMembersByPhone(from);
    if (matches.length > 0) {
      const isStop = STOP_KEYWORDS.has(body);
      const now = new Date();
      const data = isStop
        ? { commsSmsEnabled: false, smsOptedOutAt: now, smsOptIn: false, smsOptOutDate: now }
        : { commsSmsEnabled: true, smsOptedOutAt: null, smsOptIn: true, smsOptOutDate: null };

      await prisma.orgMember.updateMany({ where: { id: { in: matches.map((m) => m.id) } }, data });

      await Promise.all(
        matches.map((member) =>
          createAuditEvent({
            organizationId: member.organizationId,
            action: isStop ? "sms_consent.opt_out" : "sms_consent.opt_in",
            entityType: "OrgMember",
            entityId: member.id,
            metadata: { source: "sms_reply", keyword: body, phone: from },
          })
        )
      );
    }
  }

  return twimlResponse();
}
