import { MeetingIntelligenceError } from "./errors";

/**
 * Meeting Intelligence MVP — upload validation.
 *
 * Never trusts the browser-supplied MIME type alone: every upload is
 * cross-checked against (1) the file extension, (2) the declared MIME
 * type, and (3) a magic-byte signature read directly from the uploaded
 * bytes. All three must agree on the same format family or the upload is
 * rejected — a renamed .exe with a spoofed "audio/mpeg" Content-Type still
 * fails the magic-byte check.
 */

export const SUPPORTED_EXTENSIONS = ["mp3", "wav", "m4a", "mp4", "webm"] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

const MIME_TO_FAMILY: Record<string, SupportedExtension> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "video/mp4": "mp4",
  "audio/webm": "webm",
  "video/webm": "webm",
};

/** mp4 and m4a share the same ISO base media container and magic bytes — only the intended use differs, so they're treated as interchangeable families for the cross-check. */
function familiesCompatible(a: SupportedExtension, b: SupportedExtension): boolean {
  if (a === b) return true;
  return (a === "mp4" || a === "m4a") && (b === "mp4" || b === "m4a");
}

/** Reads a magic-byte signature from the start of the buffer — returns null when it doesn't match any supported format. */
function sniffFamilyFromBytes(buffer: Buffer): SupportedExtension | null {
  if (buffer.length < 12) return null;

  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") {
    return "wav";
  }
  if (buffer.subarray(0, 3).toString("ascii") === "ID3") return "mp3";
  // MPEG frame sync: 11 set bits (0xFF followed by top 3 bits of the next byte set).
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "mp3";
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") return "mp4";
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return "webm";

  return null;
}

export interface ValidatedUpload {
  family: SupportedExtension;
}

export function validateUploadedRecording(input: {
  originalFilename: string;
  declaredMimeType: string;
  buffer: Buffer;
}): ValidatedUpload {
  const extension = input.originalFilename.split(".").pop()?.toLowerCase();
  if (!extension || !(SUPPORTED_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_FILE_UNSUPPORTED", `Unsupported file extension${extension ? `: .${extension}` : ""}.`);
  }
  const declaredExtension = extension as SupportedExtension;

  const mimeFamily = MIME_TO_FAMILY[input.declaredMimeType];
  if (!mimeFamily) {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_FILE_UNSUPPORTED", `Unsupported content type: ${input.declaredMimeType}.`);
  }

  if (input.buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_FILE_TOO_LARGE", `File exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB limit.`);
  }
  if (input.buffer.byteLength === 0) {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_FILE_UNSUPPORTED", "The uploaded file is empty.");
  }

  if (!familiesCompatible(declaredExtension, mimeFamily)) {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_FILE_UNSUPPORTED", "The file extension does not match the declared content type.");
  }

  const sniffedFamily = sniffFamilyFromBytes(input.buffer);
  if (!sniffedFamily || !familiesCompatible(sniffedFamily, declaredExtension)) {
    throw new MeetingIntelligenceError(
      "MEETING_INTELLIGENCE_FILE_UNSUPPORTED",
      "The file's contents do not match its declared type. The browser-reported MIME type is never trusted alone."
    );
  }

  return { family: declaredExtension };
}
