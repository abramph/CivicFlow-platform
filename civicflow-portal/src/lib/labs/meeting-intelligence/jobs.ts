import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { requireOrganizationLabFeature } from "@/lib/labs/access";
import { MeetingIntelligenceError } from "./errors";
import { transitionJob } from "./state-machine";
import { requireMeetingIntelligenceConsent, type MeetingIntelligenceConsentConfirmation } from "./consent";
import { resolveMeetingIntelligenceProviderId } from "./providers/async-index";
import {
  buildMeetingIntelligenceSourceObjectKey,
  deleteMeetingRecordingObject,
  uploadMeetingRecording,
} from "./storage";
import { validateUploadedRecording } from "./upload-validation";

/** Strips path separators/control characters from a display filename — never used to build the storage key, only shown back to the uploader. */
function sanitizeDisplayFilename(filename: string): string {
  return filename.replace(/[/\\]/g, "_").replace(/[\x00-\x1f]/g, "").slice(0, 255) || "recording";
}

export interface CreateJobInput {
  organizationId: string;
  meetingId: string;
  uploadedByUserId: string;
  uploadedByUserEmail?: string | null;
  originalFilename: string;
  mimeType: string;
  consent: MeetingIntelligenceConsentConfirmation;
}

/**
 * Creates a job (CREATED) and immediately advances it to UPLOAD_PENDING —
 * the only two states a client-visible "create" call can produce. Requires
 * Labs access and full consent confirmation before touching the database.
 * The meeting is looked up scoped by organizationId, so a jobId can never
 * be attached to another organization's meeting.
 */
export async function createMeetingIntelligenceJob(input: CreateJobInput) {
  await requireOrganizationLabFeature(input.organizationId, "meetingIntelligence");
  requireMeetingIntelligenceConsent(input.consent);

  const meeting = await prisma.meeting.findFirst({ where: { id: input.meetingId, organizationId: input.organizationId } });
  if (!meeting) {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "Meeting not found in this organization.");
  }

  const job = await prisma.meetingIntelligenceJob.create({
    data: {
      organizationId: input.organizationId,
      meetingId: input.meetingId,
      uploadedByUserId: input.uploadedByUserId,
      status: "CREATED",
      provider: resolveMeetingIntelligenceProviderId(),
      originalFilename: sanitizeDisplayFilename(input.originalFilename),
      mimeType: input.mimeType,
      fileSizeBytes: 0,
      consentConfirmedAt: new Date(),
      consentConfirmedByUserId: input.uploadedByUserId,
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.uploadedByUserId,
    actorEmail: input.uploadedByUserEmail ?? null,
    action: "meeting_intelligence.job_created",
    entityType: "meeting_intelligence_job",
    entityId: job.id,
    metadata: { meetingId: input.meetingId },
  });

  return transitionJob({
    jobId: job.id,
    organizationId: input.organizationId,
    to: "UPLOAD_PENDING",
    actorUserId: input.uploadedByUserId,
    actorEmail: input.uploadedByUserEmail,
  });
}

export interface UploadRecordingInput {
  organizationId: string;
  jobId: string;
  actorUserId: string;
  actorEmail?: string | null;
  originalFilename: string;
  mimeType: string;
  buffer: Buffer;
}

/**
 * Validates (extension + MIME + magic bytes + size), uploads to Spaces
 * under the organization/meeting/job-scoped key, and transitions
 * UPLOAD_PENDING -> UPLOADED. Rejects a job not currently awaiting an
 * upload rather than silently re-uploading over an existing recording.
 */
export async function uploadMeetingIntelligenceRecording(input: UploadRecordingInput) {
  await requireOrganizationLabFeature(input.organizationId, "meetingIntelligence");

  const job = await prisma.meetingIntelligenceJob.findFirst({ where: { id: input.jobId, organizationId: input.organizationId } });
  if (!job) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "Meeting Intelligence job not found.");
  if (job.status !== "UPLOAD_PENDING") {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_UPLOAD_NOT_FOUND", "This job is not currently awaiting an upload.");
  }

  const validated = validateUploadedRecording({
    originalFilename: input.originalFilename,
    declaredMimeType: input.mimeType,
    buffer: input.buffer,
  });

  const key = buildMeetingIntelligenceSourceObjectKey(input.organizationId, job.meetingId, job.id, input.mimeType);
  await uploadMeetingRecording({ key, buffer: input.buffer, contentType: input.mimeType });

  const updated = await transitionJob({
    jobId: job.id,
    organizationId: input.organizationId,
    to: "UPLOADED",
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    extraData: {
      storageObjectKey: key,
      fileSizeBytes: input.buffer.byteLength,
      mimeType: input.mimeType,
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting_intelligence.upload_confirmed",
    entityType: "meeting_intelligence_job",
    entityId: job.id,
    metadata: { fileSizeBytes: input.buffer.byteLength, family: validated.family },
  });

  return updated;
}

export interface SubmitJobInput {
  organizationId: string;
  jobId: string;
  actorUserId: string;
  actorEmail?: string | null;
}

/** Server-side confirmation after upload, before processing begins — explicit "submit" step, not automatic on upload. */
export async function submitMeetingIntelligenceJob(input: SubmitJobInput) {
  await requireOrganizationLabFeature(input.organizationId, "meetingIntelligence");

  const job = await prisma.meetingIntelligenceJob.findFirst({ where: { id: input.jobId, organizationId: input.organizationId } });
  if (!job) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "Meeting Intelligence job not found.");
  if (job.status !== "UPLOADED") {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_UPLOAD_NOT_FOUND", "The recording must be uploaded before it can be submitted for processing.");
  }

  const updated = await transitionJob({
    jobId: job.id,
    organizationId: input.organizationId,
    to: "QUEUED",
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
  });

  return updated;
}

export interface RetryJobInput {
  organizationId: string;
  jobId: string;
  actorUserId: string;
  actorEmail?: string | null;
}

/** Retries a FAILED job by moving it back to QUEUED for the worker to pick up again — distinct from submitMeetingIntelligenceJob, which only accepts an UPLOADED job. */
export async function retryMeetingIntelligenceJob(input: RetryJobInput) {
  await requireOrganizationLabFeature(input.organizationId, "meetingIntelligence");

  const job = await prisma.meetingIntelligenceJob.findFirst({ where: { id: input.jobId, organizationId: input.organizationId } });
  if (!job) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "Meeting Intelligence job not found.");
  if (job.status !== "FAILED") {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_INVALID_TRANSITION", "Only a FAILED job can be retried.");
  }

  return transitionJob({
    jobId: job.id,
    organizationId: input.organizationId,
    to: "QUEUED",
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    extraData: { failureCode: null, failureMessage: null },
  });
}

export interface CancelJobInput {
  organizationId: string;
  jobId: string;
  actorUserId: string;
  actorEmail?: string | null;
}

export async function cancelMeetingIntelligenceJob(input: CancelJobInput) {
  const job = await prisma.meetingIntelligenceJob.findFirst({ where: { id: input.jobId, organizationId: input.organizationId } });
  if (!job) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "Meeting Intelligence job not found.");

  return transitionJob({
    jobId: job.id,
    organizationId: input.organizationId,
    to: "CANCELLED",
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
  });
}

export interface DeleteRecordingInput {
  organizationId: string;
  jobId: string;
  actorUserId: string;
  actorEmail?: string | null;
}

/**
 * Deletes only the source recording object from storage — the transcript
 * and any minutes drafts (including an APPROVED one) are never touched by
 * this function. `MeetingIntelligenceJob.status` moves to DELETED (the
 * recording/processing lifecycle), which is entirely independent of
 * `MeetingMinutesDraft.status` (the minutes lifecycle) — an approved
 * draft's own status is never altered by a recording cleanup.
 */
export async function deleteMeetingIntelligenceRecording(input: DeleteRecordingInput) {
  const job = await prisma.meetingIntelligenceJob.findFirst({ where: { id: input.jobId, organizationId: input.organizationId } });
  if (!job) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "Meeting Intelligence job not found.");

  const updated = await transitionJob({
    jobId: job.id,
    organizationId: input.organizationId,
    to: "DELETED",
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    extraData: { storageObjectKey: null },
  });

  if (job.storageObjectKey) {
    await deleteMeetingRecordingObject(job.storageObjectKey);
  }

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting_intelligence.recording_deleted",
    entityType: "meeting_intelligence_job",
    entityId: job.id,
    metadata: { hadStorageObject: Boolean(job.storageObjectKey) },
  });

  return updated;
}

export interface DeleteTranscriptInput {
  organizationId: string;
  jobId: string;
  actorUserId: string;
  actorEmail?: string | null;
  /** Must be explicitly true — the caller must confirm they understand regenerated minutes may no longer be possible once the transcript is gone. */
  acknowledgeRegenerationImpossible: boolean;
}

/** Deletes only the MeetingTranscript row — approved (or any) MeetingMinutesDraft rows are always preserved, never silently deleted by this action. */
export async function deleteMeetingIntelligenceTranscript(input: DeleteTranscriptInput) {
  if (!input.acknowledgeRegenerationImpossible) {
    throw new MeetingIntelligenceError(
      "MEETING_INTELLIGENCE_CONSENT_REQUIRED",
      "You must confirm you understand that regenerating minutes will no longer be possible once the transcript is deleted."
    );
  }

  const transcript = await prisma.meetingTranscript.findFirst({
    where: { jobId: input.jobId, organizationId: input.organizationId },
  });
  if (!transcript) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "Transcript not found for this job.");

  await prisma.meetingTranscript.delete({ where: { id: transcript.id } });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting_intelligence.transcript_deleted",
    entityType: "meeting_intelligence_job",
    entityId: input.jobId,
    metadata: {},
  });
}
