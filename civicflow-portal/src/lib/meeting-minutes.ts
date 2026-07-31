import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { sendPushToMember } from "@/lib/push";
import { sendEmail } from "@/lib/mail";
import type { MeetingMinutes, MeetingMinutesStatus } from "@prisma/client";

export class MeetingMinutesError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "MeetingMinutesError";
  }
}

/** Shared by every route under /api/meetings/[id]/minutes so each doesn't re-derive the mapping. */
export function meetingMinutesErrorResponse(error: MeetingMinutesError): Response {
  const status = error.code.endsWith("NOT_FOUND") ? 404 : 409;
  return Response.json({ ok: false, error: error.message, code: error.code }, { status });
}

/**
 * Rows in these statuses can still be edited. APPROVED and SUPERSEDED never
 * can -- approval freezes a version in place by construction (this check),
 * not just by convention or UI hiding. Correcting approved minutes always
 * creates a new version (see createMeetingMinutesDraft) rather than
 * mutating the approved row, so the record members actually saw is never
 * silently rewritten -- this is the "immutable approval history" guarantee.
 */
const EDITABLE_STATUSES = new Set<MeetingMinutesStatus>(["DRAFT", "CHANGES_REQUESTED"]);
/** A meeting can have at most one unfinished (non-terminal) version in flight at a time. */
const UNFINISHED_STATUSES = new Set<MeetingMinutesStatus>(["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED"]);

async function findMinutesOrThrow(organizationId: string, minutesId: string): Promise<MeetingMinutes> {
  const minutes = await prisma.meetingMinutes.findFirst({ where: { id: minutesId, organizationId } });
  if (!minutes) throw new MeetingMinutesError("MEETING_MINUTES_NOT_FOUND", "Meeting minutes not found in this organization.");
  return minutes;
}

/**
 * Starts a new minutes version for a meeting. Refuses to create a second
 * unfinished version while one is already in flight (DRAFT/IN_REVIEW/
 * CHANGES_REQUESTED) -- this is part of "prevention of accidental
 * publication of drafts": there is never more than one draft anyone could
 * confuse for another. Creating a new version after the current one is
 * APPROVED is allowed (correcting previously-approved minutes); the prior
 * APPROVED version is only superseded when the *new* one is itself
 * approved (see approveMeetingMinutes), so members always see the last
 * approved version rather than nothing while a correction is in progress.
 */
export async function createMeetingMinutesDraft(params: {
  organizationId: string;
  meetingId: string;
  title: string;
  bodyText: string;
  actorUserId: string;
}): Promise<MeetingMinutes> {
  const meeting = await prisma.meeting.findFirst({
    where: { id: params.meetingId, organizationId: params.organizationId },
  });
  if (!meeting) throw new MeetingMinutesError("MEETING_NOT_FOUND", "Meeting not found in this organization.");

  const latest = await prisma.meetingMinutes.findFirst({
    where: { meetingId: params.meetingId, organizationId: params.organizationId },
    orderBy: { version: "desc" },
  });
  if (latest && UNFINISHED_STATUSES.has(latest.status)) {
    throw new MeetingMinutesError(
      "MEETING_MINUTES_DRAFT_IN_PROGRESS",
      "A draft or in-review version already exists for this meeting."
    );
  }

  const minutes = await prisma.meetingMinutes.create({
    data: {
      organizationId: params.organizationId,
      meetingId: params.meetingId,
      version: latest ? latest.version + 1 : 1,
      status: "DRAFT",
      title: params.title.trim(),
      bodyText: params.bodyText,
      createdByUserId: params.actorUserId,
    },
  });

  await createAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: "meeting_minutes.draft_created",
    entityType: "meeting_minutes",
    entityId: minutes.id,
    metadata: { meetingId: params.meetingId, version: minutes.version },
  });

  return minutes;
}

export async function editMeetingMinutesDraft(params: {
  organizationId: string;
  minutesId: string;
  title?: string;
  bodyText?: string;
  actorUserId: string;
}): Promise<MeetingMinutes> {
  const existing = await findMinutesOrThrow(params.organizationId, params.minutesId);
  if (!EDITABLE_STATUSES.has(existing.status)) {
    throw new MeetingMinutesError(
      "MEETING_MINUTES_NOT_EDITABLE",
      `Minutes in status ${existing.status} cannot be edited.`
    );
  }

  const updated = await prisma.meetingMinutes.update({
    where: { id: existing.id },
    data: {
      ...(params.title !== undefined ? { title: params.title.trim() } : {}),
      ...(params.bodyText !== undefined ? { bodyText: params.bodyText } : {}),
      lastEditedByUserId: params.actorUserId,
      lastEditedAt: new Date(),
    },
  });

  await createAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: "meeting_minutes.draft_edited",
    entityType: "meeting_minutes",
    entityId: updated.id,
    metadata: { meetingId: updated.meetingId, version: updated.version },
  });

  return updated;
}

/** DRAFT or CHANGES_REQUESTED -> IN_REVIEW. The drafter (meetings:write) submits; only a holder of meetings:minutes:review/approve can act on it from here. */
export async function submitMeetingMinutesForReview(params: {
  organizationId: string;
  minutesId: string;
  actorUserId: string;
}): Promise<MeetingMinutes> {
  const existing = await findMinutesOrThrow(params.organizationId, params.minutesId);
  if (existing.status !== "DRAFT" && existing.status !== "CHANGES_REQUESTED") {
    throw new MeetingMinutesError(
      "MEETING_MINUTES_INVALID_TRANSITION",
      `Cannot submit minutes for review from status ${existing.status}.`
    );
  }

  const updated = await prisma.meetingMinutes.update({
    where: { id: existing.id },
    data: { status: "IN_REVIEW", submittedByUserId: params.actorUserId, submittedAt: new Date() },
  });

  await createAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: "meeting_minutes.submitted_for_review",
    entityType: "meeting_minutes",
    entityId: updated.id,
    metadata: { meetingId: updated.meetingId, version: updated.version },
  });

  return updated;
}

/** IN_REVIEW -> CHANGES_REQUESTED. This is the "requested changes" state -- still editable, resubmittable. Requires meetings:minutes:review. */
export async function requestMeetingMinutesChanges(params: {
  organizationId: string;
  minutesId: string;
  actorUserId: string;
  reason: string;
}): Promise<MeetingMinutes> {
  const existing = await findMinutesOrThrow(params.organizationId, params.minutesId);
  if (existing.status !== "IN_REVIEW") {
    throw new MeetingMinutesError(
      "MEETING_MINUTES_INVALID_TRANSITION",
      `Cannot request changes from status ${existing.status}.`
    );
  }

  const updated = await prisma.meetingMinutes.update({
    where: { id: existing.id },
    data: {
      status: "CHANGES_REQUESTED",
      changesRequestedByUserId: params.actorUserId,
      changesRequestedAt: new Date(),
      changesRequestedReason: params.reason.trim(),
    },
  });

  await createAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: "meeting_minutes.changes_requested",
    entityType: "meeting_minutes",
    entityId: updated.id,
    metadata: { meetingId: updated.meetingId, version: updated.version, reason: params.reason.trim() },
  });

  return updated;
}

/**
 * Notifies every member of the organization that a meeting's minutes were
 * approved. Reuses sendPushToMember per OrgMember (which already resolves a
 * PTA household's shared billing-identity member to every linked adult's
 * devices, per push.ts), so this one loop covers both conventional and PTA
 * household members without special-casing either. Every send is
 * independently swallowed -- a notification failure must never fail the
 * approval it's reporting on, mirroring the payment-report-approval pattern.
 */
async function notifyMembersOfApprovedMinutes(params: { organizationId: string; meetingTitle: string }) {
  const members = await prisma.orgMember.findMany({
    where: { organizationId: params.organizationId, membershipStatus: "active" },
    select: { id: true, email: true },
  });

  await Promise.all(
    members.map(async (member) => {
      if (member.email) {
        await sendEmail({
          to: member.email,
          subject: `Meeting minutes approved: ${params.meetingTitle}`,
          text: `The minutes for "${params.meetingTitle}" have been approved and are now available to view.`,
        }).catch(() => null);
      }
      await sendPushToMember({
        organizationId: params.organizationId,
        memberId: member.id,
        title: "Meeting minutes approved",
        body: params.meetingTitle,
        deepLink: "/m/minutes",
      }).catch(() => null);
    })
  );
}

/**
 * IN_REVIEW -> APPROVED. Requires meetings:minutes:approve (distinct from
 * :review, so a reviewer without approval authority cannot finalize
 * minutes -- mirrors Meeting Intelligence's approve route). Supersedes the
 * meeting's previous APPROVED version (if any) in the same transaction, so
 * there is never more than one APPROVED version visible at a time. Fires
 * member notifications after the transaction commits.
 */
export async function approveMeetingMinutes(params: {
  organizationId: string;
  minutesId: string;
  actorUserId: string;
}): Promise<MeetingMinutes> {
  const existing = await findMinutesOrThrow(params.organizationId, params.minutesId);
  if (existing.status !== "IN_REVIEW") {
    throw new MeetingMinutesError(
      "MEETING_MINUTES_INVALID_TRANSITION",
      `Cannot approve minutes from status ${existing.status}.`
    );
  }

  const meeting = await prisma.meeting.findFirstOrThrow({ where: { id: existing.meetingId } });

  const approved = await prisma.$transaction(async (tx) => {
    await tx.meetingMinutes.updateMany({
      where: { organizationId: params.organizationId, meetingId: existing.meetingId, status: "APPROVED" },
      data: { status: "SUPERSEDED", supersededAt: new Date() },
    });

    return tx.meetingMinutes.update({
      where: { id: existing.id },
      data: { status: "APPROVED", approvedByUserId: params.actorUserId, approvedAt: new Date() },
    });
  });

  await createAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: "meeting_minutes.approved",
    entityType: "meeting_minutes",
    entityId: approved.id,
    metadata: { meetingId: approved.meetingId, version: approved.version },
  });

  await notifyMembersOfApprovedMinutes({ organizationId: params.organizationId, meetingTitle: meeting.title }).catch(() => null);

  return approved;
}

/** All versions of a meeting's minutes, newest first -- the staff-facing history view. */
export async function getMeetingMinutesVersions(params: { organizationId: string; meetingId: string }) {
  return prisma.meetingMinutes.findMany({
    where: { organizationId: params.organizationId, meetingId: params.meetingId },
    orderBy: { version: "desc" },
  });
}

/**
 * The single shared read path for every member-facing surface (web /m/minutes,
 * the PTA vertical, and mobile) -- only ever selects status APPROVED, by
 * construction, so a draft or in-review version can never leak to a member
 * regardless of which surface is asking. This is the "member visibility
 * only after approval" guarantee.
 */
export async function getApprovedMeetingMinutes(organizationId: string) {
  return prisma.meetingMinutes.findMany({
    where: { organizationId, status: "APPROVED" },
    include: { meeting: { select: { id: true, title: true, meetingDate: true } } },
    orderBy: { approvedAt: "desc" },
  });
}
