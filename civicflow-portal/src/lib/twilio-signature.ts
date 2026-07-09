import crypto from "crypto";

/** Reconstructs the public-facing URL Twilio actually signed, in case a proxy rewrites the scheme/host. */
export function getSignatureUrl(request: Request): string {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (forwardedProto && forwardedHost) {
    const url = new URL(request.url);
    return `${forwardedProto}://${forwardedHost}${url.pathname}${url.search}`;
  }
  return request.url;
}

/** Twilio's documented request-signing algorithm: HMAC-SHA1(authToken, url + sorted "key+value" pairs), base64-encoded. */
export function computeTwilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function signaturesMatch(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

/** Verifies the X-Twilio-Signature header on an inbound webhook request against the raw form-encoded body. Returns the parsed params on success, null on failure (missing header/token or mismatch). */
export async function verifyTwilioWebhookRequest(
  request: Request,
  authToken: string | undefined
): Promise<Record<string, string> | null> {
  const signatureHeader = request.headers.get("X-Twilio-Signature");
  if (!authToken || !signatureHeader) return null;

  const rawBody = await request.text();
  const params = new URLSearchParams(rawBody);
  const paramsObject: Record<string, string> = {};
  for (const [key, value] of params.entries()) paramsObject[key] = value;

  const expectedSignature = computeTwilioSignature(getSignatureUrl(request), paramsObject, authToken);
  if (!signaturesMatch(expectedSignature, signatureHeader)) return null;

  return paramsObject;
}
