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

  // NOTE: matches OrgMember.phone by exact string equality. Phone numbers
  // entered elsewhere in the app aren't normalized to E.164, so a member
  // whose number is stored in a different format than Twilio's `From` won't
  // be matched here — acceptable for a first pass, but worth normalizing
  // phone storage before relying on this as the sole compliance mechanism.
  if (from && STOP_KEYWORDS.has(body)) {
    await prisma.orgMember.updateMany({
      where: { phone: from },
      data: { commsSmsEnabled: false, smsOptedOutAt: new Date() },
    });
  } else if (from && START_KEYWORDS.has(body)) {
    await prisma.orgMember.updateMany({
      where: { phone: from },
      data: { commsSmsEnabled: true, smsOptedOutAt: null },
    });
  }

  return twimlResponse();
}
