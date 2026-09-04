import sharp, { type Metadata, type OutputInfo } from "sharp";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { buildSafeObjectKey, uploadBufferToSpaces, deleteObjectFromSpaces, getObjectBuffer } from "@/lib/storage";
import { PtaError } from "./errors";

/**
 * Family-photo upload security pipeline (build-26 Section 6). Every upload
 * — parent self-service or officer-managed — goes through this one module,
 * so the security properties hold regardless of which route called it:
 *   1. Declared + actual size limits.
 *   2. Extension/MIME allowlist (enforced upstream in attachments.ts's
 *      ALLOWED_CONTENT_TYPES for the generic route; re-checked here too
 *      since this module doesn't assume it's only ever reached that way).
 *   3. Real file-signature (magic-byte) verification — the DECLARED
 *      content-type must match what the bytes actually are, closing the
 *      same "renamed executable" class of gap the spreadsheet-import
 *      hardening work closed for CSV/XLSX.
 *   4. Full decode via sharp — a malformed/corrupt image throws here,
 *      never reaches storage.
 *   5. Re-encode as JPEG, auto-oriented (sharp's .rotate() with no
 *      arguments reads the EXIF orientation tag, applies it, then the tag
 *      itself is gone from the output) and dimension-capped. sharp does
 *      NOT preserve metadata unless .withMetadata() is explicitly called
 *      — never called here — so EXIF/GPS/ICC/IPTC are stripped by
 *      construction, not by a separate "remove metadata" step that could
 *      be forgotten.
 */

const MAX_DECLARED_BYTES = 15 * 1024 * 1024; // matches maxAttachmentBytes in attachments.ts
const MAX_DECODED_PIXELS = 40_000_000; // sharp's own decompression-bomb guard (default limit, stated explicitly)
const MAIN_MAX_DIMENSION = 1600;
// A separate stored thumbnail object was considered and deliberately
// deferred: Attachment has no field appropriate for a second object key
// without repurposing an existing column meant for something else (e.g.
// `title`) in a way that would confuse every OTHER entity type sharing
// this model. The single normalized image below (1600px cap) already
// satisfies every hard requirement (EXIF-stripped, oriented, safely
// re-encoded, dimension-normalized); a UI wanting a small avatar can
// request this same image and let CSS/the img element size it down.

const MAGIC_BYTES: { contentType: string; check: (buffer: Buffer) => boolean }[] = [
  { contentType: "image/jpeg", check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { contentType: "image/png", check: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  {
    contentType: "image/webp",
    check: (b) => b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
  {
    // HEIC/HEIF: ISO base media file format -- a 4-byte size, then "ftyp",
    // then a 4-byte major brand. Real photos from iOS cameras/Photos use
    // one of these brands; this is a structural check (box layout), not a
    // trust-the-extension check.
    contentType: "image/heic",
    check: (b) => {
      if (b.length < 12 || b.subarray(4, 8).toString("ascii") !== "ftyp") return false;
      const brand = b.subarray(8, 12).toString("ascii");
      return ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand);
    },
  },
];

// image/heif is accepted as a declared content-type (see
// ALLOWED_CONTENT_TYPES in attachments.ts) but shares heic's ftyp check.
function detectImageSignature(buffer: Buffer): string | null {
  for (const { contentType, check } of MAGIC_BYTES) {
    if (check(buffer)) return contentType;
  }
  return null;
}

/** sharp/libvips's own format name for each magic-byte-detected type
 * (verified directly: sharp().metadata().format returns exactly these
 * lowercase, unprefixed strings — 'heif' covers both HEIC and HEIF). Used
 * to cross-check the actual DECODE result against the magic-byte
 * detection, closing the gap where a file's signature bytes match one
 * format but libvips's own (more thorough) sniffing decodes it as
 * something else entirely -- declared MIME, magic bytes, and the real
 * decode must all agree, not just the first two. */
const EXPECTED_SHARP_FORMAT: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heif",
};

export interface UploadHouseholdPhotoInput {
  organizationId: string;
  householdId: string;
  buffer: Buffer;
  declaredContentType: string;
  actorUserId: string;
  actorEmail?: string | null;
}

export interface UploadHouseholdPhotoResult {
  photoUrl: string;
  byteSize: number;
  width: number;
  height: number;
}

/** Uploads (or replaces) a household's family photo. Never trusts the
 * client's declared content-type alone — the actual bytes are decoded,
 * verified, and re-encoded from scratch. Old photo, if any, is soft-deleted
 * (Attachment.deletedAt) and its storage object removed only AFTER the new
 * upload succeeds — a failed replacement leaves the existing photo intact,
 * per Section 6's "failed replacement preserving the existing photo." */
export async function uploadHouseholdPhoto(input: UploadHouseholdPhotoInput): Promise<UploadHouseholdPhotoResult> {
  const household = await prisma.ptaHousehold.findFirst({ where: { id: input.householdId, organizationId: input.organizationId } });
  if (!household) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");

  if (input.buffer.length === 0) throw new PtaError("PTA_VALIDATION_ERROR", "The uploaded photo is empty.");
  if (input.buffer.length > MAX_DECLARED_BYTES) throw new PtaError("PTA_VALIDATION_ERROR", "Photo exceeds the 15 MB upload limit.");

  const detected = detectImageSignature(input.buffer);
  if (!detected) {
    throw new PtaError("PTA_VALIDATION_ERROR", "This file's content doesn't match a supported photo format. Choose a JPEG, PNG, HEIC/HEIF, or WEBP image.");
  }
  // The declared content-type must agree with the actual bytes -- rejects
  // an extension-spoofed upload (e.g. a script renamed to "photo.jpg")
  // exactly like the spreadsheet parser's FORMAT_MISMATCH check.
  const declaredNormalized = input.declaredContentType.toLowerCase();
  const detectedFamily = detected === "image/heic" ? ["image/heic", "image/heif"] : [detected];
  if (!detectedFamily.includes(declaredNormalized)) {
    throw new PtaError("PTA_VALIDATION_ERROR", "This file's content doesn't match its declared type. Please re-export the photo and try again.");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input.buffer, { limitInputPixels: MAX_DECODED_PIXELS }).metadata();
  } catch {
    throw new PtaError("PTA_VALIDATION_ERROR", "This photo could not be read. It may be corrupted — try a different file.");
  }
  if (!metadata.width || !metadata.height) {
    throw new PtaError("PTA_VALIDATION_ERROR", "This photo could not be read. It may be corrupted — try a different file.");
  }
  // Third leg of the agreement check: declared MIME and magic bytes were
  // already compared above -- this compares the ACTUAL decode result too,
  // so a file libvips decodes as a different format than its signature
  // bytes suggested (not the format it claimed to be at any layer) is
  // rejected rather than silently re-encoded and stored.
  if (metadata.format !== EXPECTED_SHARP_FORMAT[detected]) {
    throw new PtaError("PTA_VALIDATION_ERROR", "This file's content doesn't match its declared type. Please re-export the photo and try again.");
  }

  let mainBuffer: Buffer;
  let outputInfo: OutputInfo;
  try {
    const pipeline = sharp(input.buffer, { limitInputPixels: MAX_DECODED_PIXELS })
      .rotate() // auto-orient from EXIF, then the orientation tag is gone
      .resize({ width: MAIN_MAX_DIMENSION, height: MAIN_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 }); // re-encode -- .withMetadata() is never called, so EXIF/GPS/ICC/IPTC are dropped by construction
    const result = await pipeline.toBuffer({ resolveWithObject: true });
    mainBuffer = result.data;
    outputInfo = result.info;
  } catch {
    throw new PtaError("PTA_VALIDATION_ERROR", "This photo could not be processed. It may be corrupted — try a different file.");
  }

  const previousAttachment = await prisma.attachment.findFirst({
    where: { organizationId: input.organizationId, entityType: "PTA_HOUSEHOLD", entityId: input.householdId, purpose: "FAMILY_PHOTO", deletedAt: null },
  });

  const mainKey = buildSafeObjectKey(`attachments/${input.organizationId}/pta_household/${input.householdId}`, "family-photo.jpg");
  await uploadBufferToSpaces({ key: mainKey, buffer: mainBuffer, contentType: "image/jpeg" });

  const attachment = await prisma.attachment.create({
    data: {
      organizationId: input.organizationId,
      entityType: "PTA_HOUSEHOLD",
      entityId: input.householdId,
      purpose: "FAMILY_PHOTO",
      fileName: "family-photo.jpg",
      contentType: "image/jpeg",
      byteSize: mainBuffer.byteLength,
      objectKey: mainKey,
      uploadedByUserId: input.actorUserId,
    },
  });

  // Deliberately NOT the generic /api/attachments/[id]/download route: that
  // route is gated purely by attachmentPermission() (pta:households:manage
  // for this entity type), which ordinary parents never hold. This path is
  // the dual-audience route in households/[householdId]/photo/route.ts,
  // which accepts either an officer with directory-read OR the household's
  // own linked parent.
  const photoUrl = `/api/labs/pta/households/${input.householdId}/photo`;
  await prisma.ptaHousehold.update({ where: { id: input.householdId }, data: { photoUrl } });

  // Clean up the previous photo only after the new one is fully committed
  // — a failure above never reaches this point, so the old photo (and its
  // Attachment row / storage object) is untouched on any failure path.
  //
  // The superseded object's deletion failure used to be swallowed
  // (.catch(() => {})), which is how a replacement could leave a previous
  // family image in the bucket indefinitely with nothing recording it. The
  // new photo is already live and correct at this point, so failing the whole
  // request would be wrong — instead the failure is made OBSERVABLE and
  // RETRYABLE: an audit event names the orphaned attachment, and
  // purgeOrphanedHouseholdPhotoObjects re-attempts it (removal also sweeps).
  let supersededObjectOrphaned = false;
  if (previousAttachment) {
    await prisma.attachment.update({ where: { id: previousAttachment.id }, data: { deletedAt: new Date(), deletedByUserId: input.actorUserId } });
    try {
      await deleteObjectFromSpaces(previousAttachment.objectKey);
    } catch {
      supersededObjectOrphaned = true;
    }
  }

  // Never logs image bytes or EXIF/GPS metadata -- only non-sensitive
  // shape facts (byte size, dimensions after normalization).
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: previousAttachment ? "pta.household.photo_replaced" : "pta.household.photo_uploaded",
    entityType: "pta_household",
    entityId: input.householdId,
    metadata: { attachmentId: attachment.id, byteSize: mainBuffer.byteLength, width: outputInfo.width, height: outputInfo.height },
  });

  // A separate, findable record so a superseded image left in storage is
  // never invisible. Carries the attachment id only -- no bytes, no storage
  // key -- which is all a retry needs to re-derive the object server-side.
  if (supersededObjectOrphaned && previousAttachment) {
    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail ?? null,
      action: "pta.household.photo_object_cleanup_failed",
      entityType: "pta_household",
      entityId: input.householdId,
      metadata: { attachmentId: previousAttachment.id, retryable: true },
    });
  }

  return { photoUrl, byteSize: mainBuffer.byteLength, width: outputInfo.width, height: outputInfo.height };
}

export async function deleteHouseholdPhoto(input: { organizationId: string; householdId: string; actorUserId: string; actorEmail?: string | null }): Promise<void> {
  const household = await prisma.ptaHousehold.findFirst({ where: { id: input.householdId, organizationId: input.organizationId } });
  if (!household) throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");

  const attachment = await prisma.attachment.findFirst({
    where: { organizationId: input.organizationId, entityType: "PTA_HOUSEHOLD", entityId: input.householdId, purpose: "FAMILY_PHOTO", deletedAt: null },
  });
  // Repeat removal is a safe no-op. Any tombstoned object left behind by an
  // earlier partial failure is still swept up, so retrying is always useful
  // rather than silently doing nothing.
  if (!attachment) {
    await purgeOrphanedHouseholdPhotoObjects(input.organizationId);
    return;
  }

  // ORDER MATTERS. The storage object is deleted FIRST, and its failure is
  // NOT swallowed.
  //
  // Previously this tombstoned the row and then called
  // deleteObjectFromSpaces(...).catch(() => {}), so a storage outage reported
  // a successful removal to the parent while their family's photo remained in
  // the bucket. "Remove" has to mean the bytes are gone, and a caller must
  // never be told they are gone when they are not.
  //
  // Deleting first also makes the failure modes safe in both directions:
  //   * storage delete fails  -> nothing changed, photo still consistently
  //     present, caller gets a retryable error and can try again;
  //   * database update fails -> the object is already gone, so the image
  //     cannot be served no matter what the row says. getHouseholdPhotoBytes
  //     treats a missing object as "no photo", so this is a recoverable
  //     missing-object state, never a way to see the image again.
  try {
    await deleteObjectFromSpaces(attachment.objectKey);
  } catch {
    throw new PtaError(
      "PTA_HOUSEHOLD_PHOTO_DELETE_FAILED",
      "The photo could not be removed right now. Nothing was changed — please try again in a moment."
    );
  }

  await prisma.$transaction([
    prisma.attachment.update({ where: { id: attachment.id }, data: { deletedAt: new Date(), deletedByUserId: input.actorUserId } }),
    prisma.ptaHousehold.update({ where: { id: input.householdId }, data: { photoUrl: null } }),
  ]);

  // Records who and when. Deliberately carries no image bytes, no dimensions
  // of the removed image, and no storage key -- attachmentId is enough to
  // re-derive anything an operator needs, server-side.
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.household.photo_deleted",
    entityType: "pta_household",
    entityId: input.householdId,
    metadata: { attachmentId: attachment.id },
  });
}

/** Returns the current Attachment row for a household's photo, if any. */
export async function getHouseholdPhotoAttachment(organizationId: string, householdId: string) {
  return prisma.attachment.findFirst({
    where: { organizationId, entityType: "PTA_HOUSEHOLD", entityId: householdId, purpose: "FAMILY_PHOTO", deletedAt: null },
  });
}

export interface HouseholdPhotoBytes {
  buffer: Buffer;
  /** The server's own normalized type. Never the client's declared type: every
   * stored family photo is re-encoded to JPEG by uploadHouseholdPhoto. */
  contentType: string;
  byteSize: number;
}

/**
 * Reads a household's family photo as BYTES, for routes that serve the image
 * to an already-authorized caller.
 *
 * This exists because family photos are household and children's data, and a
 * signed object-storage URL is a bearer credential: once issued it works for
 * anyone who obtains it, from any client, with no further authorization and no
 * way to revoke it before it expires. Callers must therefore never receive a
 * storage URL, a redirect to storage, or an object key — they receive bytes
 * from an endpoint that authorized them first.
 *
 * Every caller MUST have completed its own authorization before calling this.
 * The organizationId/householdId pair must already be server-resolved; this
 * function deliberately performs no access control of its own so that no route
 * can mistake it for a guard.
 *
 * Returns null when there is no active photo, and also when the metadata row
 * exists but its object does not — the recoverable state a removal can leave
 * behind if the database update fails after the object is deleted. Both are
 * "no photo" to a caller; neither is a server error.
 */
export async function getHouseholdPhotoBytes(
  organizationId: string,
  householdId: string
): Promise<HouseholdPhotoBytes | null> {
  const attachment = await getHouseholdPhotoAttachment(organizationId, householdId);
  if (!attachment) return null;

  let buffer: Buffer;
  try {
    buffer = await getObjectBuffer(attachment.objectKey);
  } catch {
    // Deliberately swallows the storage error's detail rather than
    // propagating it: the message can carry the bucket and object key, and
    // this value is on its way to an HTTP response. A missing object is
    // reported to the caller as "no photo", never as a 5xx carrying storage
    // internals.
    return null;
  }

  return { buffer, contentType: attachment.contentType, byteSize: buffer.byteLength };
}

/**
 * Re-attempts object deletion for family-photo attachments that were
 * tombstoned but whose storage object may still exist — the state a
 * replacement leaves behind when its cleanup delete fails.
 *
 * Deliberately small and callable rather than a scheduled job: the operation
 * is idempotent (deleting an absent key succeeds), so re-running it is always
 * safe, and introducing a queue/worker framework for one cleanup path would be
 * a much larger change than the problem warrants.
 *
 * Returns the number of objects it successfully deleted or confirmed absent.
 */
export async function purgeOrphanedHouseholdPhotoObjects(organizationId: string): Promise<{ attempted: number; purged: number }> {
  const tombstoned = await prisma.attachment.findMany({
    where: { organizationId, entityType: "PTA_HOUSEHOLD", purpose: "FAMILY_PHOTO", deletedAt: { not: null } },
    select: { id: true, objectKey: true },
  });
  let purged = 0;
  for (const row of tombstoned) {
    try {
      await deleteObjectFromSpaces(row.objectKey);
      purged += 1;
    } catch {
      // Left for the next run; never throws, so one unreachable object cannot
      // block cleanup of the rest.
    }
  }
  return { attempted: tombstoned.length, purged };
}
