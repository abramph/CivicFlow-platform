import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { MeetingIntelligenceError } from "./errors";

/**
 * Internal APH pilot feedback — captured from the tenant user reviewing a
 * job's output, tied to that job. Not a general customer-feedback platform
 * (see docs/meeting-intelligence-pilot.md's "Pilot feedback" section).
 * `comments` describes the tool's output quality, never meeting content.
 */

const RATING_MIN = 1;
const RATING_MAX = 5;

export const MEETING_INTELLIGENCE_ISSUE_CATEGORIES = [
  "transcription",
  "speaker_labels",
  "minutes_accuracy",
  "review_ux",
  "export",
  "performance",
  "reliability",
  "other",
] as const;

export type MeetingIntelligenceFeedbackIssueCategory = (typeof MEETING_INTELLIGENCE_ISSUE_CATEGORIES)[number];

function isValidIssueCategory(value: string): value is MeetingIntelligenceFeedbackIssueCategory {
  return (MEETING_INTELLIGENCE_ISSUE_CATEGORIES as readonly string[]).includes(value);
}

function isValidRating(value: number | null | undefined): value is number {
  return value != null && Number.isInteger(value) && value >= RATING_MIN && value <= RATING_MAX;
}

export interface SubmitFeedbackInput {
  organizationId: string;
  jobId: string;
  actorUserId: string;
  overallRating: number;
  transcriptionQualityRating?: number | null;
  speakerLabelQualityRating?: number | null;
  minutesAccuracyRating?: number | null;
  timeSavedMinutes?: number | null;
  correctionsRequired?: boolean | null;
  issueCategory?: string | null;
  comments?: string | null;
}

/**
 * Creates or overwrites the caller's own feedback for a job — an atomic
 * upsert on the (jobId, submittedByUserId) unique constraint, so two
 * near-simultaneous submissions from the same user (e.g. a double-click)
 * can never create duplicate rows or race on a check-then-act insert.
 * Only the submitter's own row is ever written; there is no "submit
 * feedback as another user" path.
 */
export async function submitMeetingIntelligenceFeedback(input: SubmitFeedbackInput) {
  if (!isValidRating(input.overallRating)) {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_FEEDBACK_INVALID", `overallRating must be an integer between ${RATING_MIN} and ${RATING_MAX}.`);
  }
  for (const [label, value] of [
    ["transcriptionQualityRating", input.transcriptionQualityRating],
    ["speakerLabelQualityRating", input.speakerLabelQualityRating],
    ["minutesAccuracyRating", input.minutesAccuracyRating],
  ] as const) {
    if (value != null && !isValidRating(value)) {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_FEEDBACK_INVALID", `${label} must be an integer between ${RATING_MIN} and ${RATING_MAX}.`);
    }
  }
  if (input.issueCategory != null && !isValidIssueCategory(input.issueCategory)) {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_FEEDBACK_INVALID", `Unknown issueCategory: ${input.issueCategory}`);
  }
  if (input.timeSavedMinutes != null && (!Number.isFinite(input.timeSavedMinutes) || input.timeSavedMinutes < 0)) {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_FEEDBACK_INVALID", "timeSavedMinutes must be a non-negative number.");
  }

  const job = await prisma.meetingIntelligenceJob.findFirst({ where: { id: input.jobId, organizationId: input.organizationId } });
  if (!job) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "Meeting Intelligence job not found.");

  // Feedback about output quality only makes sense once the job has
  // actually produced something to review (or definitively failed) —
  // rejecting earlier stages (CREATED/QUEUED/TRANSCRIBING/...) avoids a
  // meaningless "5 stars" submitted before any output exists.
  const FEEDBACK_ELIGIBLE_STAGES = new Set(["DRAFT_READY", "IN_REVIEW", "APPROVED", "FAILED"]);
  if (!FEEDBACK_ELIGIBLE_STAGES.has(job.status)) {
    throw new MeetingIntelligenceError(
      "MEETING_INTELLIGENCE_FEEDBACK_NOT_ELIGIBLE",
      "Feedback can only be submitted once a job has reached a draft, review, approved, or failed stage."
    );
  }

  const data = {
    overallRating: input.overallRating,
    transcriptionQualityRating: input.transcriptionQualityRating ?? null,
    speakerLabelQualityRating: input.speakerLabelQualityRating ?? null,
    minutesAccuracyRating: input.minutesAccuracyRating ?? null,
    timeSavedMinutes: input.timeSavedMinutes ?? null,
    correctionsRequired: input.correctionsRequired ?? null,
    issueCategory: input.issueCategory ?? null,
    // Cap defensively — this is operator-facing tool feedback, not a document store.
    comments: input.comments ? input.comments.slice(0, 4000) : null,
  };

  const feedback = await prisma.meetingIntelligenceFeedback.upsert({
    where: { jobId_submittedByUserId: { jobId: input.jobId, submittedByUserId: input.actorUserId } },
    create: {
      organizationId: input.organizationId,
      jobId: input.jobId,
      submittedByUserId: input.actorUserId,
      ...data,
    },
    update: data,
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "meeting_intelligence.feedback_submitted",
    entityType: "meeting_intelligence_feedback",
    entityId: feedback.id,
    // Never the free-text comment — only shape/quantitative metadata.
    metadata: { jobId: input.jobId, overallRating: input.overallRating, issueCategory: input.issueCategory ?? null },
  });

  return feedback;
}

export async function listMeetingIntelligenceFeedbackForJob(organizationId: string, jobId: string) {
  return prisma.meetingIntelligenceFeedback.findMany({
    where: { organizationId, jobId },
    orderBy: { createdAt: "desc" },
  });
}
