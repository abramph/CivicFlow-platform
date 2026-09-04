import { sanitizeContentDispositionFilename, type ObjectStream } from "@/lib/storage";

/** Types a browser renders in place rather than saves. Anything not on this
 * list is offered as a download. Deliberately narrow and explicit: SVG is
 * excluded because it is a scriptable document, not a passive image. */
const INLINE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

export interface AttachmentBytesInput {
  stream: ObjectStream;
  /** The server's stored type — never a value echoed back from the client on
   * this request. */
  contentType: string;
  fileName: string;
  /** The size recorded at upload, used when storage does not report one. */
  byteSize: number | null;
}

/**
 * The single way an attachment's bytes leave the server.
 *
 * This route used to end in a redirect to a signed object-storage URL. A
 * signed URL is a bearer credential: once issued it works for anyone who holds
 * it, from any client, with no authorization check and no way to revoke it
 * before it expires — and it is served by a host that has no idea who is
 * asking. Attachments here include reimbursement receipts, payment reports,
 * meeting recordings and organization logos, so the same reasoning that
 * removed signed URLs from family photos applies.
 *
 * The body is streamed, not buffered: the largest attachments this app accepts
 * are 150MB meeting recordings.
 */
export function attachmentBytesResponse({ stream, contentType, fileName, byteSize }: AttachmentBytesInput): Response {
  const safeName = sanitizeContentDispositionFilename(fileName);
  // Renderable types stay inline so an <img src> keeps working — organization
  // logos are served through this same route. Everything else is offered as a
  // save, now with the ORIGINAL filename: a redirect to storage produced
  // whatever the object key's last segment happened to be.
  const disposition = INLINE_CONTENT_TYPES.has(contentType.toLowerCase())
    ? `inline; filename="${safeName}"`
    : `attachment; filename="${safeName}"`;

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": disposition,
    // These are receipts, recordings and internal documents. Never let a
    // shared cache hold them, and never let one linger on disk.
    "Cache-Control": "private, no-store",
    // The bytes originate from an uploader, so never let a browser sniff its
    // way to a different, scriptable type.
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };

  const length = stream.contentLength ?? byteSize;
  if (typeof length === "number" && length >= 0) headers["Content-Length"] = String(length);

  return new Response(stream.body, { status: 200, headers });
}

/** Used both for an attachment that does not exist and for one the caller may
 * not see — the route deliberately does not distinguish the two. Also covers
 * the case where the metadata row outlived its object. */
export function attachmentNotFoundResponse(): Response {
  return Response.json(
    { ok: false, error: "Attachment not found." },
    { status: 404, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }
  );
}
