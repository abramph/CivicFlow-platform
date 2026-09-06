import sharp, { type Metadata } from "sharp";
import { PtaError } from "./errors";

/**
 * Shared image-upload security pipeline for PTA photos (Build 27 extraction).
 *
 * This is the exact validation/normalization sequence household-photo.ts has
 * enforced since Build 26 (its module doc describes the five properties),
 * extracted verbatim so the student photo cannot ship a second, subtly
 * different upload path — the "do not create a second insecure image-upload
 * path" rule made structural:
 *   1. Declared + actual size limits.
 *   2. Real file-signature (magic-byte) verification.
 *   3. Declared MIME must agree with the magic bytes.
 *   4. Full decode via sharp (40 MP decompression-bomb guard) whose decoded
 *      format must ALSO agree with the magic bytes — three-way agreement.
 *   5. Re-encode as an auto-oriented, dimension-capped JPEG with
 *      .withMetadata() never called, so EXIF/GPS/ICC/IPTC are stripped by
 *      construction.
 */

export const MAX_DECLARED_BYTES = 15 * 1024 * 1024; // matches maxAttachmentBytes in attachments.ts
const MAX_DECODED_PIXELS = 40_000_000; // sharp's own decompression-bomb guard (default limit, stated explicitly)
const MAIN_MAX_DIMENSION = 1600;

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
 * lowercase, unprefixed strings — 'heif' covers both HEIC and HEIF). */
const EXPECTED_SHARP_FORMAT: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heif",
};

export interface ProcessedPhoto {
  /** Normalized JPEG bytes — always safe to store and serve as image/jpeg. */
  buffer: Buffer;
  width: number;
  height: number;
}

/** Validates and normalizes an uploaded photo, or throws a user-facing
 * PtaError. Never trusts the declared content-type alone. */
export async function processPhotoUpload(buffer: Buffer, declaredContentType: string): Promise<ProcessedPhoto> {
  if (buffer.length === 0) throw new PtaError("PTA_VALIDATION_ERROR", "The uploaded photo is empty.");
  if (buffer.length > MAX_DECLARED_BYTES) throw new PtaError("PTA_VALIDATION_ERROR", "Photo exceeds the 15 MB upload limit.");

  const detected = detectImageSignature(buffer);
  if (!detected) {
    throw new PtaError("PTA_VALIDATION_ERROR", "This file's content doesn't match a supported photo format. Choose a JPEG, PNG, HEIC/HEIF, or WEBP image.");
  }
  // The declared content-type must agree with the actual bytes -- rejects
  // an extension-spoofed upload (e.g. a script renamed to "photo.jpg")
  // exactly like the spreadsheet parser's FORMAT_MISMATCH check.
  const declaredNormalized = declaredContentType.toLowerCase();
  const detectedFamily = detected === "image/heic" ? ["image/heic", "image/heif"] : [detected];
  if (!detectedFamily.includes(declaredNormalized)) {
    throw new PtaError("PTA_VALIDATION_ERROR", "This file's content doesn't match its declared type. Please re-export the photo and try again.");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: MAX_DECODED_PIXELS }).metadata();
  } catch {
    throw new PtaError("PTA_VALIDATION_ERROR", "This photo could not be read. It may be corrupted — try a different file.");
  }
  if (!metadata.width || !metadata.height) {
    throw new PtaError("PTA_VALIDATION_ERROR", "This photo could not be read. It may be corrupted — try a different file.");
  }
  // Third leg of the agreement check: declared MIME and magic bytes were
  // already compared above -- this compares the ACTUAL decode result too,
  // so a file libvips decodes as a different format than its signature
  // bytes suggested is rejected rather than silently re-encoded and stored.
  if (metadata.format !== EXPECTED_SHARP_FORMAT[detected]) {
    throw new PtaError("PTA_VALIDATION_ERROR", "This file's content doesn't match its declared type. Please re-export the photo and try again.");
  }

  try {
    const pipeline = sharp(buffer, { limitInputPixels: MAX_DECODED_PIXELS })
      .rotate() // auto-orient from EXIF, then the orientation tag is gone
      .resize({ width: MAIN_MAX_DIMENSION, height: MAIN_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 }); // re-encode -- .withMetadata() is never called, so EXIF/GPS/ICC/IPTC are dropped by construction
    const result = await pipeline.toBuffer({ resolveWithObject: true });
    return { buffer: result.data, width: result.info.width, height: result.info.height };
  } catch {
    throw new PtaError("PTA_VALIDATION_ERROR", "This photo could not be processed. It may be corrupted — try a different file.");
  }
}
