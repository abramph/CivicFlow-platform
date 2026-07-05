import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP"]);

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** Reconstructs the public-facing URL Twilio actually signed, in case a proxy rewrites the scheme/host. */
function getSignatureUrl(request: Request): string {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (forwardedProto && forwardedHost) {
    const url = new URL(request.url);
    return `${forwardedProto}://${forwardedHost}${url.pathname}${url.search}`;
  }
  return request.url;
}

/** Twilio's documented request-signing algorithm: HMAC-SHA1(authToken, url + sorted "key+value" pairs), base64-encoded. */
function computeTwilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

function signaturesMatch(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function twimlResponse() {
  return new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });
}

/**
 * Twilio inbound SMS webhook — handles STOP/START compliance keywords.
 * Not wired to real traffic until this URL is configured as the phone
 * number's "A Message Comes In" webhook in the Twilio console (see
 * docs/sms-setup.md). Twilio also has its own carrier-level STOP handling
 * (Advanced Opt-Out) — this is a second, application-level layer so we never
 * queue a new send to an opted-out member even if that's misconfigured.
 */
export async function POST(request: Request) {
  const rateLimited = await requireRateLimit({
    scope: "webhooks:twilio:inbound",
    request,
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const authToken = process.env.SMS_API_KEY;
  const signatureHeader = request.headers.get("X-Twilio-Signature");
  if (!authToken || !signatureHeader) {
    return new Response("Forbidden", { status: 403 });
  }

  const rawBody = await request.text();
  const params = new URLSearchParams(rawBody);
  const paramsObject: Record<string, string> = {};
  for (const [key, value] of params.entries()) paramsObject[key] = value;

  const expectedSignature = computeTwilioSignature(getSignatureUrl(request), paramsObject, authToken);
  if (!signaturesMatch(expectedSignature, signatureHeader)) {
    return new Response("Forbidden", { status: 403 });
  }

  const from = paramsObject.From;
  const body = (paramsObject.Body ?? "").trim().toUpperCase();

  if (from && (STOP_KEYWORDS.has(body) || START_KEYWORDS.has(body))) {
    const matchingIds = await findMemberIdsByPhone(from);
    if (matchingIds.length > 0) {
      const data = STOP_KEYWORDS.has(body)
        ? { commsSmsEnabled: false, smsOptedOutAt: new Date() }
        : { commsSmsEnabled: true, smsOptedOutAt: null };
      await prisma.orgMember.updateMany({ where: { id: { in: matchingIds } }, data });
    }
  }

  return twimlResponse();
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * OrgMember.phone is free text (manual entry or CSV import) and rarely
 * stored in E.164, while Twilio's `From` always is — so an exact string
 * match would miss most members. Matches by digits only, against either
 * the full number or just the last 10 (to catch a stored number missing
 * its "1" country code), via a raw query since Prisma can't express a
 * normalize-then-compare filter directly.
 */
async function findMemberIdsByPhone(from: string): Promise<string[]> {
  const fullDigits = digitsOnly(from);
  const last10Digits = fullDigits.slice(-10);
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "OrgMember"
    WHERE phone IS NOT NULL
      AND regexp_replace(phone, '\D', '', 'g') IN (${fullDigits}, ${last10Digits})
  `;
  return rows.map((row) => row.id);
}
