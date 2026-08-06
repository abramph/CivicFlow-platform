import { randomUUID } from "crypto";
import { deleteObjectFromSpaces, getObjectBuffer, uploadBufferToSpaces } from "@/lib/storage";

/**
 * Resumable Import Program (PR A) — storage. Reuses the platform's existing
 * DigitalOcean Spaces integration (src/lib/storage.ts) exactly, mirroring
 * src/lib/labs/meeting-intelligence/storage.ts's wrapper shape — no new
 * bucket, credential set, or storage primitive. Private objects only
 * (uploadBufferToSpaces already sets ACL: "private"), no filename or
 * sensitive text anywhere in the key.
 */

const EXTENSION_FOR_MIME: Record<string, string> = {
  "text/csv": "csv",
  "application/csv": "csv",
  "application/vnd.ms-excel": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

/** organizations/{organizationId}/imports/{batchId}/source/{objectId}.{ext} — no filename/PII anywhere in the key. */
export function buildImportSourceObjectKey(organizationId: string, batchId: string, mimeType: string): string {
  const extension = EXTENSION_FOR_MIME[mimeType] ?? "csv";
  return `organizations/${organizationId}/imports/${batchId}/source/${randomUUID()}.${extension}`;
}

export async function uploadImportSourceFile(params: { key: string; buffer: Buffer; contentType: string }) {
  return uploadBufferToSpaces({ key: params.key, buffer: params.buffer, contentType: params.contentType });
}

export async function getImportSourceFile(key: string): Promise<Buffer> {
  return getObjectBuffer(key);
}

export async function deleteImportSourceObject(key: string): Promise<void> {
  return deleteObjectFromSpaces(key);
}

/** Matches Meeting Intelligence's RECORDING_RETENTION_DAYS precedent (src/lib/labs/meeting-intelligence/storage.ts). */
export const IMPORT_SOURCE_RETENTION_DAYS = 30;

export function computeImportRetentionDate(uploadedAt: Date): Date {
  const deletionDate = new Date(uploadedAt);
  deletionDate.setDate(deletionDate.getDate() + IMPORT_SOURCE_RETENTION_DAYS);
  return deletionDate;
}
