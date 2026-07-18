import { buildSafeObjectKey } from "@/lib/storage";
import { DEFAULT_RECORDING_RETENTION_DAYS, DEFAULT_TRANSCRIPT_RETENTION_DAYS } from "./privacy";

/**
 * Meeting Intelligence Technical Spike — storage architecture.
 *
 * Recordings and transcripts reuse the platform's existing DigitalOcean
 * Spaces integration (`src/lib/storage.ts` — `buildSafeObjectKey`,
 * `uploadBufferToSpaces`, `getSignedObjectUrl`, already used for
 * attachments, receipts, and report exports). No new storage primitive,
 * bucket, or credential set is needed for a production implementation —
 * this module only proves the naming/retention scheme, and calls the real
 * key-building helper (a pure function, no network I/O) to do it.
 */

/** Object key convention: meeting-recordings/{organizationId}/{meetingId}/{date}/{uuid}-{filename} — organizationId as the top-level segment keeps a future bulk-deletion-by-org operation to a single prefix scan. */
export function buildMeetingRecordingObjectKey(organizationId: string, meetingId: string, fileName: string): string {
  return buildSafeObjectKey(`meeting-recordings/${organizationId}/${meetingId}`, fileName);
}

/** Generated artifacts (transcript JSON, draft minutes JSON) get their own prefix, separate from the raw audio, since they have a different retention window (see privacy.ts) and much lower storage cost/risk. */
export function buildMeetingArtifactObjectKey(organizationId: string, meetingId: string, artifact: "transcript" | "draft-minutes", fileName: string): string {
  return buildSafeObjectKey(`meeting-artifacts/${organizationId}/${meetingId}/${artifact}`, fileName);
}

export function computeRecordingDeletionDate(uploadedAt: Date): Date {
  const deletionDate = new Date(uploadedAt);
  deletionDate.setDate(deletionDate.getDate() + DEFAULT_RECORDING_RETENTION_DAYS);
  return deletionDate;
}

export function computeArtifactDeletionDate(generatedAt: Date): Date {
  const deletionDate = new Date(generatedAt);
  deletionDate.setDate(deletionDate.getDate() + DEFAULT_TRANSCRIPT_RETENTION_DAYS);
  return deletionDate;
}

export interface StorageLifecyclePlan {
  objectKey: string;
  encryptedAtRest: true;
  temporaryProcessingOnly: boolean;
  deleteAfter: string;
  accessMethod: "signed_url";
  signedUrlTtlSeconds: number;
}

/**
 * Recordings are never stored permanently by default — this plan is what a
 * production upload handler would persist alongside the job record so a
 * scheduled cleanup job knows exactly when to delete each object, without
 * needing to re-derive the retention window from org settings at delete
 * time (which could have changed since upload).
 */
export function planRecordingStorage(organizationId: string, meetingId: string, fileName: string, uploadedAt: Date): StorageLifecyclePlan {
  return {
    objectKey: buildMeetingRecordingObjectKey(organizationId, meetingId, fileName),
    encryptedAtRest: true,
    temporaryProcessingOnly: true,
    deleteAfter: computeRecordingDeletionDate(uploadedAt).toISOString(),
    accessMethod: "signed_url",
    // Short-lived — just long enough for the transcription provider to
    // fetch the file once, not a durable link a client holds onto.
    signedUrlTtlSeconds: 3600,
  };
}
