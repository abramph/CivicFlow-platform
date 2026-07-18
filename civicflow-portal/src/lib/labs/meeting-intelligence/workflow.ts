/**
 * Meeting Intelligence Technical Spike — workflow state machine.
 *
 * Create Meeting -> Start Recording -> Recording Upload -> Storage ->
 * Background Queue -> Speech-to-Text -> Speaker Segmentation ->
 * AI Processing -> Draft Minutes -> Secretary Review -> Approval ->
 * Official Minutes -> Archive
 *
 * Modeled as data (not just prose) so the allowed-transition rules and
 * per-stage failure handling can be unit tested, and so a real
 * implementation's job-tracking table can be validated against the exact
 * same rules rather than re-deriving them.
 */

export const MEETING_JOB_STAGES = [
  "CREATED",
  "RECORDING",
  "UPLOADING",
  "STORED",
  "QUEUED",
  "TRANSCRIBING",
  "DIARIZING",
  "AI_PROCESSING",
  "DRAFT_READY",
  "IN_REVIEW",
  "APPROVED",
  "ARCHIVED",
  "FAILED",
  "CANCELLED",
] as const;

export type MeetingJobStage = (typeof MEETING_JOB_STAGES)[number];

/**
 * Allowed forward transitions. CREATED can go straight to UPLOADING
 * (a pre-recorded file, uploaded rather than captured live) or RECORDING
 * (live capture) — see Phase 3's recording architecture. IN_REVIEW can loop
 * back to DRAFT_READY (secretary requests regeneration) rather than only
 * moving forward. FAILED can return to QUEUED for a retry — it is not a
 * dead end, unlike CANCELLED/ARCHIVED which are.
 */
const FORWARD_TRANSITIONS: Record<MeetingJobStage, MeetingJobStage[]> = {
  CREATED: ["RECORDING", "UPLOADING", "CANCELLED"],
  RECORDING: ["UPLOADING", "FAILED", "CANCELLED"],
  UPLOADING: ["STORED", "FAILED", "CANCELLED"],
  STORED: ["QUEUED", "CANCELLED"],
  QUEUED: ["TRANSCRIBING", "FAILED", "CANCELLED"],
  TRANSCRIBING: ["DIARIZING", "FAILED"],
  DIARIZING: ["AI_PROCESSING", "FAILED"],
  AI_PROCESSING: ["DRAFT_READY", "FAILED"],
  DRAFT_READY: ["IN_REVIEW", "FAILED"],
  IN_REVIEW: ["APPROVED", "DRAFT_READY", "CANCELLED"],
  APPROVED: ["ARCHIVED"],
  ARCHIVED: [],
  FAILED: ["QUEUED", "CANCELLED"],
  CANCELLED: [],
};

export function canTransition(from: MeetingJobStage, to: MeetingJobStage): boolean {
  return FORWARD_TRANSITIONS[from]?.includes(to) ?? false;
}

/** ARCHIVED and CANCELLED are true dead ends; FAILED is deliberately not terminal since a retry re-queues it. */
export function isTerminalStage(stage: MeetingJobStage): boolean {
  return stage === "ARCHIVED" || stage === "CANCELLED";
}

export interface StageFailureHandling {
  retryable: boolean;
  /** Whether a platform operator should be notified (vs. the failure being routine/expected and self-service recoverable). */
  operatorNotified: boolean;
  organizationFacingMessage: string;
}

export const FAILURE_HANDLING: Record<
  Extract<MeetingJobStage, "RECORDING" | "UPLOADING" | "QUEUED" | "TRANSCRIBING" | "DIARIZING" | "AI_PROCESSING" | "DRAFT_READY">,
  StageFailureHandling
> = {
  RECORDING: {
    retryable: true,
    operatorNotified: false,
    organizationFacingMessage: "The recording could not be captured. You can start a new recording or upload a file instead.",
  },
  UPLOADING: {
    retryable: true,
    operatorNotified: false,
    organizationFacingMessage: "The upload was interrupted. Please try uploading the recording again — partial uploads are not billed or processed.",
  },
  QUEUED: {
    retryable: true,
    operatorNotified: true,
    organizationFacingMessage: "Processing hasn't started yet due to a system issue. Our team has been notified; you don't need to do anything.",
  },
  TRANSCRIBING: {
    retryable: true,
    operatorNotified: true,
    organizationFacingMessage: "Transcription failed. This has been automatically retried once; if it fails again our team is notified.",
  },
  DIARIZING: {
    // Diarization failing is recoverable without redoing transcription — a
    // real implementation should fall back to a single "Speaker A" for the
    // whole recording rather than failing the entire job outright.
    retryable: true,
    operatorNotified: true,
    organizationFacingMessage: "Speaker separation failed — the transcript is still available without speaker labels while we investigate.",
  },
  AI_PROCESSING: {
    retryable: true,
    operatorNotified: true,
    organizationFacingMessage: "Draft minutes could not be generated. The raw transcript remains available; you can retry AI processing at any time.",
  },
  DRAFT_READY: {
    // Not a real failure mode today (nothing happens automatically at
    // DRAFT_READY), reserved for a future auto-distribution/notification
    // step that could itself fail without affecting the draft's validity.
    retryable: true,
    operatorNotified: false,
    organizationFacingMessage: "The draft is ready, but a notification to the secretary may not have been delivered — check the meeting's Draft Minutes page directly.",
  },
};

export interface MeetingJobEvent {
  stage: MeetingJobStage;
  occurredAt: string;
  detail?: string;
}

/** Validates a proposed sequence of stage transitions against the state machine — used by tests and by any future job-tracking write path to reject an impossible jump (e.g. CREATED straight to APPROVED). */
export function validateJobHistory(events: MeetingJobEvent[]): { valid: boolean; error?: string } {
  if (events.length === 0) return { valid: false, error: "A job history must have at least one event." };
  if (events[0].stage !== "CREATED") {
    return { valid: false, error: `Job history must start at CREATED, got ${events[0].stage}.` };
  }
  for (let i = 1; i < events.length; i += 1) {
    const from = events[i - 1].stage;
    const to = events[i].stage;
    if (!canTransition(from, to)) {
      return { valid: false, error: `Invalid transition from ${from} to ${to} at step ${i}.` };
    }
  }
  return { valid: true };
}
