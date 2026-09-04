import type { HouseholdPhotoBytes } from "./household-photo";

/**
 * The single way a family photo leaves the server.
 *
 * Every route that serves one — mobile bearer-authenticated, or web
 * session-authenticated — returns through here, so there is one image-security
 * pipeline for this feature rather than two that can drift apart.
 *
 * What this deliberately never does:
 *   * redirect to object storage,
 *   * return a signed storage URL,
 *   * return an object key or bucket name,
 *   * echo a client-supplied content type.
 *
 * The Content-Type is the server's own stored value. Every family photo is
 * re-encoded to JPEG by uploadHouseholdPhoto, so this is a normalized,
 * server-generated type and not something a client ever influenced.
 */
export function familyPhotoBytesResponse(photo: HouseholdPhotoBytes): Response {
  // Buffer -> fresh Uint8Array so the response body is a plain ArrayBuffer
  // view rather than a Node Buffer backed by a pooled allocation.
  const body = new Uint8Array(photo.buffer);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(body.byteLength),
      // A family photo must not be written to a shared cache, and must not be
      // left on disk by an intermediary or the client's HTTP cache. `private`
      // alone still permits browser disk caching; `no-store` is what actually
      // forbids retention.
      "Cache-Control": "private, no-store",
      // The bytes are attacker-influenced in origin (a parent uploaded them),
      // so never let a browser sniff its way to a different, scriptable type.
      "X-Content-Type-Options": "nosniff",
      // Belt and braces for the same reason: nothing here should ever be
      // treated as a document.
      "Content-Disposition": "inline",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/**
 * "There is no photo" — used both when a household has never set one and when
 * the metadata row outlived its object (the recoverable state a removal can
 * leave if its database update fails after the object is deleted).
 *
 * Both are the same answer to a caller, and neither is a server error. The
 * body carries no household name, no identifiers, and no storage detail.
 */
export function noFamilyPhotoResponse(): Response {
  return Response.json(
    { ok: false, error: "No family photo on file." },
    { status: 404, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }
  );
}
