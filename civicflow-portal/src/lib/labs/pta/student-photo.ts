import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { buildSafeObjectKey, uploadBufferToSpaces, deleteObjectFromSpaces, getObjectBuffer } from "@/lib/storage";
import { PtaError } from "./errors";
import { processPhotoUpload } from "./photo-pipeline";

/**
 * Student photo (Build 27) — the household family-photo module's exact
 * sibling, sharing the identical validation/normalization pipeline
 * (photo-pipeline.ts) and the identical storage/removal/audit contract
 * documented in docs/pta-family-photo-privacy.md, which covers this module
 * too. A student's photo is a child's image: bytes-only delivery from
 * authorizing routes, never a signed URL, never the generic RBAC-gated
 * attachments route; "remove" means the storage object is deleted first
 * and its failure is never swallowed; audit records carry ids and shape
 * facts only — never a name, key, URL, or byte content.
 */

export interface UploadStudentPhotoInput {
  organizationId: string;
  studentId: string;
  buffer: Buffer;
  declaredContentType: string;
  actorUserId: string;
  actorEmail?: string | null;
}

export interface UploadStudentPhotoResult {
  photoUrl: string;
  byteSize: number;
  width: number;
  height: number;
}

/** Uploads (or replaces) a student's photo. The old photo, if any, is
 * tombstoned and its storage object removed only AFTER the new upload
 * succeeds — a failed replacement leaves the existing photo intact. */
export async function uploadStudentPhoto(input: UploadStudentPhotoInput): Promise<UploadStudentPhotoResult> {
  const student = await prisma.ptaStudent.findFirst({ where: { id: input.studentId, organizationId: input.organizationId } });
  if (!student) throw new PtaError("PTA_STUDENT_NOT_FOUND", "Student not found in this organization.");

  const processed = await processPhotoUpload(input.buffer, input.declaredContentType);

  const previousAttachment = await prisma.attachment.findFirst({
    where: { organizationId: input.organizationId, entityType: "PTA_STUDENT", entityId: input.studentId, purpose: "STUDENT_PHOTO", deletedAt: null },
  });

  const mainKey = buildSafeObjectKey(`attachments/${input.organizationId}/pta_student/${input.studentId}`, "student-photo.jpg");
  await uploadBufferToSpaces({ key: mainKey, buffer: processed.buffer, contentType: "image/jpeg" });

  const attachment = await prisma.attachment.create({
    data: {
      organizationId: input.organizationId,
      entityType: "PTA_STUDENT",
      entityId: input.studentId,
      purpose: "STUDENT_PHOTO",
      fileName: "student-photo.jpg",
      contentType: "image/jpeg",
      byteSize: processed.buffer.byteLength,
      objectKey: mainKey,
      uploadedByUserId: input.actorUserId,
    },
  });

  // The dual-audience authenticated route — never the generic
  // /api/attachments/[id]/download (RBAC-permission-gated, parents never
  // hold it) and never a storage URL.
  const photoUrl = `/api/labs/pta/students/${input.studentId}/photo`;
  await prisma.ptaStudent.update({ where: { id: input.studentId }, data: { photoUrl } });

  // Superseded-object cleanup mirrors the household module: made observable
  // and retryable rather than failing a request whose new photo is already
  // live, or being swallowed silently.
  let supersededObjectOrphaned = false;
  if (previousAttachment) {
    await prisma.attachment.update({ where: { id: previousAttachment.id }, data: { deletedAt: new Date(), deletedByUserId: input.actorUserId } });
    try {
      await deleteObjectFromSpaces(previousAttachment.objectKey);
    } catch {
      supersededObjectOrphaned = true;
    }
  }

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: previousAttachment ? "pta.student.photo_replaced" : "pta.student.photo_uploaded",
    entityType: "pta_student",
    entityId: input.studentId,
    metadata: { attachmentId: attachment.id, byteSize: processed.buffer.byteLength, width: processed.width, height: processed.height },
  });

  if (supersededObjectOrphaned && previousAttachment) {
    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail ?? null,
      action: "pta.student.photo_object_cleanup_failed",
      entityType: "pta_student",
      entityId: input.studentId,
      metadata: { attachmentId: previousAttachment.id, retryable: true },
    });
  }

  return { photoUrl, byteSize: processed.buffer.byteLength, width: processed.width, height: processed.height };
}

export async function deleteStudentPhoto(input: { organizationId: string; studentId: string; actorUserId: string; actorEmail?: string | null }): Promise<void> {
  const student = await prisma.ptaStudent.findFirst({ where: { id: input.studentId, organizationId: input.organizationId } });
  if (!student) throw new PtaError("PTA_STUDENT_NOT_FOUND", "Student not found in this organization.");

  const attachment = await prisma.attachment.findFirst({
    where: { organizationId: input.organizationId, entityType: "PTA_STUDENT", entityId: input.studentId, purpose: "STUDENT_PHOTO", deletedAt: null },
  });
  // Repeat removal is a safe no-op that still sweeps earlier partial
  // failures, so retrying is always useful.
  if (!attachment) {
    await purgeOrphanedStudentPhotoObjects(input.organizationId);
    return;
  }

  // ORDER MATTERS — storage object first, failure NOT swallowed. "Remove"
  // must mean the bytes are gone; see deleteHouseholdPhoto's doc for the
  // failure-mode analysis in both directions.
  try {
    await deleteObjectFromSpaces(attachment.objectKey);
  } catch {
    throw new PtaError(
      "PTA_STUDENT_PHOTO_DELETE_FAILED",
      "The photo could not be removed right now. Nothing was changed — please try again in a moment."
    );
  }

  await prisma.$transaction([
    prisma.attachment.update({ where: { id: attachment.id }, data: { deletedAt: new Date(), deletedByUserId: input.actorUserId } }),
    prisma.ptaStudent.update({ where: { id: input.studentId }, data: { photoUrl: null } }),
  ]);

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.student.photo_deleted",
    entityType: "pta_student",
    entityId: input.studentId,
    metadata: { attachmentId: attachment.id },
  });
}

/** Returns the current Attachment row for a student's photo, if any. */
export async function getStudentPhotoAttachment(organizationId: string, studentId: string) {
  return prisma.attachment.findFirst({
    where: { organizationId, entityType: "PTA_STUDENT", entityId: studentId, purpose: "STUDENT_PHOTO", deletedAt: null },
  });
}

export interface StudentPhotoBytes {
  buffer: Buffer;
  /** The server's own normalized type — always image/jpeg after upload. */
  contentType: string;
  byteSize: number;
}

/**
 * Reads a student's photo as BYTES for an already-authorized caller. Performs
 * no access control of its own (same contract as getHouseholdPhotoBytes — no
 * route can mistake it for a guard); returns null for "no photo" and for a
 * metadata row whose object is missing, and never lets a storage error's
 * bucket/key detail reach an HTTP response.
 */
export async function getStudentPhotoBytes(organizationId: string, studentId: string): Promise<StudentPhotoBytes | null> {
  const attachment = await getStudentPhotoAttachment(organizationId, studentId);
  if (!attachment) return null;

  let buffer: Buffer;
  try {
    buffer = await getObjectBuffer(attachment.objectKey);
  } catch {
    return null;
  }

  return { buffer, contentType: attachment.contentType, byteSize: buffer.byteLength };
}

/** Re-attempts object deletion for tombstoned student-photo attachments —
 * identical retry contract to purgeOrphanedHouseholdPhotoObjects. */
export async function purgeOrphanedStudentPhotoObjects(organizationId: string): Promise<{ attempted: number; purged: number }> {
  const tombstoned = await prisma.attachment.findMany({
    where: { organizationId, entityType: "PTA_STUDENT", purpose: "STUDENT_PHOTO", deletedAt: { not: null } },
    select: { id: true, objectKey: true },
  });
  let purged = 0;
  for (const row of tombstoned) {
    try {
      await deleteObjectFromSpaces(row.objectKey);
      purged += 1;
    } catch {
      // Left for the next run.
    }
  }
  return { attempted: tombstoned.length, purged };
}
