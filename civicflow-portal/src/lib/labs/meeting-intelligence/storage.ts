import { randomUUID } from "crypto";
import { deleteObjectFromSpaces, getSignedObjectUrl, uploadBufferToSpaces } from "@/lib/storage";

/**
 * Meeting Intelligence MVP — storage. Reuses the platform's existing
 * DigitalOcean Spaces integration (src/lib/storage.ts) exactly — no new
 * bucket, credential set, or storage primitive. Private objects only
 * (uploadBufferToSpaces already sets ACL: "private"), signed read URLs
 * only (never a public/durable link), randomized object identifiers, and
 * no names/titles/sensitive text anywhere in the key.
 */

const EXTENSION_FOR_MIME: Record<string, string> = {
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

/** organizations/{organizationId}/meeting-intelligence/{meetingId}/{jobId}/source/{objectId}.{ext} — exactly the path shape specified for the MVP. No filename, meeting title, or attendee text anywhere in the key. */
export function buildMeetingIntelligenceSourceObjectKey(
  organizationId: string,
  meetingId: string,
  jobId: string,
  mimeType: string
): string {
  const extension = EXTENSION_FOR_MIME[mimeType] ?? "bin";
  return `organizations/${organizationId}/meeting-intelligence/${meetingId}/${jobId}/source/${randomUUID()}.${extension}`;
}

/** Transcript JSON artifacts get their own prefix, separate from the source recording — different retention window, far lower risk. */
export function buildMeetingIntelligenceTranscriptObjectKey(organizationId: string, meetingId: string, jobId: string): string {
  return `organizations/${organizationId}/meeting-intelligence/${meetingId}/${jobId}/transcript/${randomUUID()}.json`;
}

export async function uploadMeetingRecording(params: { key: string; buffer: Buffer; contentType: string }) {
  return uploadBufferToSpaces({ key: params.key, buffer: params.buffer, contentType: params.contentType });
}

export async function uploadMeetingTranscriptArtifact(params: { key: string; buffer: Buffer }) {
  return uploadBufferToSpaces({ key: params.key, buffer: params.buffer, contentType: "application/json" });
}

/** Short-lived by default — just long enough for the transcription provider to fetch the file once, never a durable link a client holds onto. */
export async function getSignedRecordingUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  return getSignedObjectUrl(key, expiresInSeconds);
}

export async function deleteMeetingRecordingObject(key: string): Promise<void> {
  return deleteObjectFromSpaces(key);
}

export const RECORDING_RETENTION_DAYS = 30;

export function computeRecordingDeletionDate(uploadedAt: Date): Date {
  const deletionDate = new Date(uploadedAt);
  deletionDate.setDate(deletionDate.getDate() + RECORDING_RETENTION_DAYS);
  return deletionDate;
}
