import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { MeetingIntelligenceError } from "./errors";
import { transitionJob } from "./state-machine";
import { generateMeetingMinutes } from "./minutes";
import type { StructuredMeetingMinutes } from "./minutes";

/** Draft statuses whose editableContentJson may still be changed — an APPROVED row is immutable by construction, a SUPERSEDED row is historical. */
const EDITABLE_STATUSES = new Set(["DRAFT", "IN_REVIEW", "REJECTED"]);

/**
 * MeetingMinutesDraft has a unique constraint on (jobId, version) precisely
 * to catch this: a check-then-act race (getLatestMeetingMinutesDraft then
 * create()) can't be made fully atomic without a DB-level backstop, since
 * this module is called from both the worker (protected by a claim, see
 * worker.ts) and directly from the regenerate API route (not claim-
 * protected — a double-click or two browser tabs can race it). Callers
 * catch P2002 here and adopt the winning row instead of surfacing a raw
 * Prisma error.
 */
function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function getLatestMeetingMinutesDraft(organizationId: string, jobId: string) {
  return prisma.meetingMinutesDraft.findFirst({
    where: { organizationId, jobId },
    orderBy: { version: "desc" },
  });
}

export async function getMeetingMinutesDraftHistory(organizationId: string, jobId: string) {
  return prisma.meetingMinutesDraft.findMany({
    where: { organizationId, jobId },
    orderBy: { version: "asc" },
  });
}

export interface CreateDraftInput {
  organizationId: string;
  jobId: string;
  content: StructuredMeetingMinutes;
  generatorId: string;
}

/** Called by the worker once minutes generation completes — always version 1 for a fresh job (regeneration uses regenerateMeetingMinutesDraft below, which increments). */
export async function createMeetingMinutesDraft(input: CreateDraftInput) {
  const existing = await getLatestMeetingMinutesDraft(input.organizationId, input.jobId);
  if (existing) {
    // Duplicate-generation guard: a worker retry that re-observes a job
    // already at GENERATING_MINUTES/DRAFT_READY must not create a second
    // version-1 draft.
    return existing;
  }
  try {
    return await prisma.meetingMinutesDraft.create({
      data: {
        organizationId: input.organizationId,
        meetingId: (await prisma.meetingIntelligenceJob.findUniqueOrThrow({ where: { id: input.jobId }, select: { meetingId: true } })).meetingId,
        jobId: input.jobId,
        status: "DRAFT",
        version: 1,
        generatedContentJson: input.content as unknown as object,
        editableContentJson: input.content as unknown as object,
        generatedByProvider: input.generatorId,
        generatedAt: new Date(),
      },
    });
  } catch (error) {
    // Lost a race against another concurrent caller that already created
    // version 1 for this job (see the module doc comment above) — adopt
    // the winning row instead of failing.
    if (!isUniqueConstraintError(error)) throw error;
    const winner = await getLatestMeetingMinutesDraft(input.organizationId, input.jobId);
    if (!winner) throw error;
    return winner;
  }
}

export interface EditDraftInput {
  organizationId: string;
  jobId: string;
  actorUserId: string;
  actorEmail?: string | null;
  editableContent: StructuredMeetingMinutes;
}

export async function editMeetingMinutesDraft(input: EditDraftInput) {
  const draft = await getLatestMeetingMinutesDraft(input.organizationId, input.jobId);
  if (!draft) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "No minutes draft found for this job.");
  if (!EDITABLE_STATUSES.has(draft.status)) {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_DRAFT_NOT_EDITABLE", `Draft is ${draft.status} and can no longer be edited.`);
  }

  const updated = await prisma.meetingMinutesDraft.update({
    where: { id: draft.id },
    data: {
      editableContentJson: input.editableContent as unknown as object,
      lastEditedByUserId: input.actorUserId,
      lastEditedAt: new Date(),
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting_intelligence.draft_edited",
    entityType: "meeting_minutes_draft",
    entityId: draft.id,
    metadata: { version: draft.version },
  });

  return updated;
}

export interface RequestReviewInput {
  organizationId: string;
  jobId: string;
  actorUserId: string;
  actorEmail?: string | null;
}

export async function requestMeetingMinutesReview(input: RequestReviewInput) {
  const draft = await getLatestMeetingMinutesDraft(input.organizationId, input.jobId);
  if (!draft) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "No minutes draft found for this job.");
  if (draft.status !== "DRAFT") {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_DRAFT_NOT_EDITABLE", `Draft is ${draft.status}, expected DRAFT.`);
  }

  await transitionJob({ jobId: input.jobId, organizationId: input.organizationId, to: "IN_REVIEW", actorUserId: input.actorUserId, actorEmail: input.actorEmail });

  const updated = await prisma.meetingMinutesDraft.update({ where: { id: draft.id }, data: { status: "IN_REVIEW" } });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting_intelligence.review_requested",
    entityType: "meeting_minutes_draft",
    entityId: draft.id,
    metadata: { version: draft.version },
  });

  return updated;
}

export interface ApproveDraftInput {
  organizationId: string;
  jobId: string;
  actorUserId: string;
  actorEmail?: string | null;
}

/**
 * Approval freezes the draft in place (status: APPROVED) — no route or
 * function anywhere mutates editableContentJson on an APPROVED row
 * (editMeetingMinutesDraft rejects it via EDITABLE_STATUSES), so the
 * approved snapshot is immutable by construction, not just convention.
 * Only a human with meetingIntelligence:approve can reach this function —
 * there is no automatic-approval code path anywhere in this module.
 */
export async function approveMeetingMinutesDraft(input: ApproveDraftInput) {
  const draft = await getLatestMeetingMinutesDraft(input.organizationId, input.jobId);
  if (!draft) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "No minutes draft found for this job.");
  if (draft.status !== "IN_REVIEW") {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_DRAFT_NOT_EDITABLE", `Draft is ${draft.status}, expected IN_REVIEW before it can be approved.`);
  }

  const updated = await prisma.meetingMinutesDraft.update({
    where: { id: draft.id },
    data: { status: "APPROVED", approvedByUserId: input.actorUserId, approvedAt: new Date() },
  });

  await transitionJob({ jobId: input.jobId, organizationId: input.organizationId, to: "APPROVED", actorUserId: input.actorUserId, actorEmail: input.actorEmail });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting_intelligence.draft_approved",
    entityType: "meeting_minutes_draft",
    entityId: draft.id,
    metadata: { version: draft.version, approvedAt: updated.approvedAt?.toISOString() },
  });

  return updated;
}

export interface RejectDraftInput {
  organizationId: string;
  jobId: string;
  actorUserId: string;
  actorEmail?: string | null;
  reason?: string;
}

/** A rejected draft remains editable (see EDITABLE_STATUSES) — rejection is not deletion, and does not require immediately regenerating. */
export async function rejectMeetingMinutesDraft(input: RejectDraftInput) {
  const draft = await getLatestMeetingMinutesDraft(input.organizationId, input.jobId);
  if (!draft) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "No minutes draft found for this job.");
  if (draft.status !== "IN_REVIEW") {
    throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_DRAFT_NOT_EDITABLE", `Draft is ${draft.status}, expected IN_REVIEW before it can be rejected.`);
  }

  const updated = await prisma.meetingMinutesDraft.update({
    where: { id: draft.id },
    data: { status: "REJECTED", rejectedByUserId: input.actorUserId, rejectedAt: new Date(), rejectionReason: input.reason ?? null },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting_intelligence.draft_rejected",
    entityType: "meeting_minutes_draft",
    entityId: draft.id,
    // Reason is operator-facing context, never transcript/draft content — kept short deliberately.
    metadata: { version: draft.version },
  });

  return updated;
}

export interface RegenerateDraftInput {
  organizationId: string;
  jobId: string;
  actorUserId: string;
  actorEmail?: string | null;
}

/**
 * Creates a NEW draft version rather than mutating any existing row — the
 * previous version (whatever its status, including a rejected or an
 * approved one being explicitly superseded) is marked SUPERSEDED, never
 * deleted, so version history remains fully queryable.
 */
export async function regenerateMeetingMinutesDraft(input: RegenerateDraftInput) {
  const transcript = await prisma.meetingTranscript.findFirst({ where: { jobId: input.jobId, organizationId: input.organizationId } });
  if (!transcript) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "No transcript found for this job.");

  const previous = await getLatestMeetingMinutesDraft(input.organizationId, input.jobId);
  if (!previous) throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_JOB_NOT_FOUND", "No minutes draft found for this job.");

  const job = await prisma.meetingIntelligenceJob.findUniqueOrThrow({ where: { id: input.jobId } });
  const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: job.meetingId } });

  const { result, generatorId } = await generateMeetingMinutes({
    meetingTitle: meeting.title,
    meetingDate: meeting.meetingDate?.toISOString() ?? null,
    segments: transcript.segmentsJson as never,
    fullText: transcript.content,
    speakerLabelMap: (transcript.speakerLabelMapJson as Record<string, string>) ?? undefined,
  });

  await prisma.meetingMinutesDraft.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });

  let created;
  try {
    created = await prisma.meetingMinutesDraft.create({
      data: {
        organizationId: input.organizationId,
        meetingId: job.meetingId,
        jobId: input.jobId,
        status: "DRAFT",
        version: previous.version + 1,
        generatedContentJson: result as unknown as object,
        editableContentJson: result as unknown as object,
        generatedByProvider: generatorId,
        generatedAt: new Date(),
      },
    });
  } catch (error) {
    // Lost a race against a concurrent regenerate call (e.g. a double-click
    // or two browser tabs) targeting the same next version number — see
    // the module doc comment above. Adopt the winner's row rather than
    // erroring; this call's freshly generated content is discarded.
    if (!isUniqueConstraintError(error)) throw error;
    const winner = await getLatestMeetingMinutesDraft(input.organizationId, input.jobId);
    if (!winner) throw error;
    created = winner;
  }

  await transitionJob({ jobId: input.jobId, organizationId: input.organizationId, to: "DRAFT_READY", actorUserId: input.actorUserId, actorEmail: input.actorEmail });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting_intelligence.draft_generated",
    entityType: "meeting_minutes_draft",
    entityId: created.id,
    metadata: { version: created.version, supersedes: previous.id },
  });

  return created;
}
