import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import type { MeetingIntelligenceStatus, Prisma } from "@prisma/client";

/**
 * Meeting Intelligence MVP — the authoritative workflow state machine.
 *
 * Supersedes the stage list from the technical spike (PR #14,
 * src/lib/labs/meeting-intelligence/workflow.ts, left unchanged as
 * historical spike documentation) with the production stage set. No route
 * handler, worker, or UI action may write `MeetingIntelligenceJob.status`
 * directly via prisma — every status change goes through `transitionJob()`
 * below, which validates the transition, writes the relevant timestamp,
 * and writes an audit event in the same call.
 */

export const MEETING_INTELLIGENCE_STAGES = [
  "CREATED",
  "UPLOAD_PENDING",
  "UPLOADED",
  "QUEUED",
  "SUBMITTED_TO_PROVIDER",
  "TRANSCRIBING",
  "TRANSCRIBED",
  "GENERATING_MINUTES",
  "DRAFT_READY",
  "IN_REVIEW",
  "APPROVED",
  "FAILED",
  "CANCELLED",
  "DELETED",
] as const satisfies readonly MeetingIntelligenceStatus[];

export type MeetingIntelligenceStage = (typeof MEETING_INTELLIGENCE_STAGES)[number];

/**
 * DELETED is reachable from almost every non-CREATED stage (explicit
 * recording/transcript deletion, or retention cleanup, can happen at any
 * point once a recording exists) and is the only true dead end. FAILED is
 * retryable back to QUEUED. IN_REVIEW can send a draft back to DRAFT_READY
 * for regeneration rather than only moving forward.
 */
const FORWARD_TRANSITIONS: Record<MeetingIntelligenceStage, MeetingIntelligenceStage[]> = {
  CREATED: ["UPLOAD_PENDING", "CANCELLED"],
  UPLOAD_PENDING: ["UPLOADED", "FAILED", "CANCELLED"],
  UPLOADED: ["QUEUED", "CANCELLED", "DELETED"],
  QUEUED: ["SUBMITTED_TO_PROVIDER", "FAILED", "CANCELLED", "DELETED"],
  SUBMITTED_TO_PROVIDER: ["TRANSCRIBING", "FAILED", "CANCELLED", "DELETED"],
  TRANSCRIBING: ["TRANSCRIBED", "FAILED", "DELETED"],
  TRANSCRIBED: ["GENERATING_MINUTES", "FAILED", "DELETED"],
  GENERATING_MINUTES: ["DRAFT_READY", "FAILED", "DELETED"],
  DRAFT_READY: ["IN_REVIEW", "FAILED", "DELETED"],
  IN_REVIEW: ["APPROVED", "DRAFT_READY", "CANCELLED", "DELETED"],
  APPROVED: ["DELETED"],
  FAILED: ["QUEUED", "CANCELLED", "DELETED"],
  CANCELLED: ["DELETED"],
  DELETED: [],
};

export function canTransition(from: MeetingIntelligenceStage, to: MeetingIntelligenceStage): boolean {
  return FORWARD_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalStage(stage: MeetingIntelligenceStage): boolean {
  return stage === "DELETED";
}

export interface StageFailureHandling {
  retryable: boolean;
  operatorNotified: boolean;
  organizationFacingMessage: string;
}

export const FAILURE_HANDLING: Partial<Record<MeetingIntelligenceStage, StageFailureHandling>> = {
  UPLOAD_PENDING: {
    retryable: true,
    operatorNotified: false,
    organizationFacingMessage: "The upload was interrupted. Please try uploading again — partial uploads are not processed.",
  },
  QUEUED: {
    retryable: true,
    operatorNotified: true,
    organizationFacingMessage: "Processing hasn't started due to a system issue. Our team has been notified.",
  },
  SUBMITTED_TO_PROVIDER: {
    retryable: true,
    operatorNotified: true,
    organizationFacingMessage: "The transcription service could not accept this recording. This has been flagged to our team.",
  },
  TRANSCRIBING: {
    retryable: true,
    operatorNotified: true,
    organizationFacingMessage: "Transcription failed. You can retry, or contact support if this keeps happening.",
  },
  TRANSCRIBED: {
    retryable: true,
    operatorNotified: true,
    organizationFacingMessage: "Draft minutes could not be generated. The transcript remains available; you can retry generation.",
  },
  GENERATING_MINUTES: {
    retryable: true,
    operatorNotified: true,
    organizationFacingMessage: "Draft minutes could not be generated. The transcript remains available; you can retry generation.",
  },
};

export class InvalidTransitionError extends Error {
  readonly code = "MEETING_INTELLIGENCE_INVALID_TRANSITION";
  constructor(readonly from: string, readonly to: string) {
    super(`Cannot transition Meeting Intelligence job from ${from} to ${to}.`);
    this.name = "InvalidTransitionError";
  }
}

export class JobNotFoundError extends Error {
  readonly code = "MEETING_INTELLIGENCE_JOB_NOT_FOUND";
  constructor() {
    super("Meeting Intelligence job not found.");
    this.name = "JobNotFoundError";
  }
}

/** Which timestamp column reaching a given stage writes — mirrors the schema's per-stage timestamp fields exactly, so a route never has to remember which field name goes with which stage. */
const TIMESTAMP_FIELD_FOR_STAGE: Partial<Record<MeetingIntelligenceStage, string>> = {
  SUBMITTED_TO_PROVIDER: "submittedAt",
  TRANSCRIBING: "processingStartedAt",
  TRANSCRIBED: "transcribedAt",
  DRAFT_READY: "minutesGeneratedAt",
  APPROVED: "completedAt",
  FAILED: "failedAt",
  CANCELLED: "cancelledAt",
  DELETED: "recordingDeletedAt",
};

export interface TransitionJobInput {
  jobId: string;
  /** Every lookup is scoped by organizationId — never trust a bare jobId from a route param without this. */
  organizationId: string;
  to: MeetingIntelligenceStage;
  actorUserId?: string | null;
  actorEmail?: string | null;
  failureCode?: string;
  failureMessage?: string;
  /** Additional columns to set atomically with the status change (e.g. providerJobId, storageObjectKey) — merged into the same update, never a second write. */
  extraData?: Prisma.MeetingIntelligenceJobUpdateInput;
}

/**
 * The sole write path for `MeetingIntelligenceJob.status`. Idempotent for
 * a same-state "transition" (returns the job unchanged rather than
 * throwing or re-writing timestamps/audit — safe for a worker retry that
 * re-observes a stage it already reached). Throws `InvalidTransitionError`
 * for any transition not in the allowed table, and `JobNotFoundError` if
 * the job doesn't belong to the given organizationId (tenant isolation).
 */
export async function transitionJob(input: TransitionJobInput) {
  const job = await prisma.meetingIntelligenceJob.findFirst({
    where: { id: input.jobId, organizationId: input.organizationId },
  });
  if (!job) throw new JobNotFoundError();

  if (job.status === input.to) return job;

  if (!canTransition(job.status as MeetingIntelligenceStage, input.to)) {
    throw new InvalidTransitionError(job.status, input.to);
  }

  const timestampField = TIMESTAMP_FIELD_FOR_STAGE[input.to];
  const data: Prisma.MeetingIntelligenceJobUpdateInput = {
    ...(input.extraData ?? {}),
    status: input.to,
    ...(timestampField ? { [timestampField]: new Date() } : {}),
    ...(input.to === "FAILED"
      ? { failureCode: input.failureCode ?? null, failureMessage: input.failureMessage ?? null }
      : {}),
  };

  const updated = await prisma.meetingIntelligenceJob.update({ where: { id: job.id }, data });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    actorEmail: input.actorEmail ?? null,
    action: `meeting_intelligence.job.${input.to.toLowerCase()}`,
    entityType: "meeting_intelligence_job",
    entityId: job.id,
    metadata: {
      previousStatus: job.status,
      newStatus: input.to,
      ...(input.to === "FAILED" ? { failureCode: input.failureCode ?? null } : {}),
    },
  });

  return updated;
}
