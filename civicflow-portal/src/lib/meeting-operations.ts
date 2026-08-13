import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";

/**
 * PTA Vertical 2.0, PR PTA-C — Meetings 2.0 core operations: agendas,
 * motions & the Decision Register, and action items. Core module (every
 * vertical runs meetings and passes motions); PTA-specific presentation
 * stays in the PTA vertical. QR attendance and the immutable minutes
 * workflow are deliberately untouched — this composes alongside them.
 */

export class MeetingOperationError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "MeetingOperationError";
    this.status = status;
  }
}

async function requireMeetingInOrg(organizationId: string, meetingId: string) {
  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId, organizationId } });
  if (!meeting) throw new MeetingOperationError("Meeting not found.", 404);
  return meeting;
}

// ─── Meeting lifecycle ───────────────────────────────────────────────────────

const ALLOWED_STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["DRAFT", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: ["SCHEDULED"],
};

/** COMPLETED is terminal (the record of a held meeting); CANCELLED can be
 * re-scheduled. Everything else follows the natural planning flow. */
export async function setMeetingStatus(input: {
  organizationId: string;
  meetingId: string;
  status: "DRAFT" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  actorUserId: string;
  actorEmail?: string | null;
}) {
  const meeting = await requireMeetingInOrg(input.organizationId, input.meetingId);
  if (meeting.status === input.status) return meeting;
  if (!ALLOWED_STATUS_TRANSITIONS[meeting.status]?.includes(input.status)) {
    throw new MeetingOperationError(`A ${meeting.status.toLowerCase().replace("_", " ")} meeting cannot move to ${input.status.toLowerCase().replace("_", " ")}.`);
  }
  const updated = await prisma.meeting.update({ where: { id: meeting.id }, data: { status: input.status } });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting.status_changed",
    entityType: "meeting",
    entityId: meeting.id,
    metadata: { before: meeting.status, after: input.status },
  });
  return updated;
}

// ─── Agenda ──────────────────────────────────────────────────────────────────

export async function addAgendaItem(input: {
  organizationId: string;
  meetingId: string;
  title: string;
  description?: string | null;
  presenterName?: string | null;
  durationMinutes?: number | null;
  actorUserId: string;
  actorEmail?: string | null;
}) {
  const title = input.title.trim();
  if (!title) throw new MeetingOperationError("Agenda item title is required.");
  await requireMeetingInOrg(input.organizationId, input.meetingId);
  const last = await prisma.meetingAgendaItem.findFirst({
    where: { organizationId: input.organizationId, meetingId: input.meetingId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const item = await prisma.meetingAgendaItem.create({
    data: {
      organizationId: input.organizationId,
      meetingId: input.meetingId,
      title,
      description: input.description ?? null,
      presenterName: input.presenterName ?? null,
      durationMinutes: input.durationMinutes ?? null,
      sortOrder: (last?.sortOrder ?? 0) + 10,
    },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting.agenda_item_added",
    entityType: "meeting",
    entityId: input.meetingId,
    metadata: { title },
  });
  return item;
}

export async function removeAgendaItem(input: { organizationId: string; agendaItemId: string; actorUserId: string; actorEmail?: string | null }) {
  const item = await prisma.meetingAgendaItem.findFirst({ where: { id: input.agendaItemId, organizationId: input.organizationId } });
  if (!item) throw new MeetingOperationError("Agenda item not found.", 404);
  await prisma.meetingAgendaItem.delete({ where: { id: item.id } });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting.agenda_item_removed",
    entityType: "meeting",
    entityId: item.meetingId,
    metadata: { title: item.title },
  });
}

// ─── Motions & Decision Register ────────────────────────────────────────────

export async function recordMotion(input: {
  organizationId: string;
  meetingId: string;
  text: string;
  moverName?: string | null;
  seconderName?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}) {
  const text = input.text.trim();
  if (!text) throw new MeetingOperationError("Motion text is required.");
  await requireMeetingInOrg(input.organizationId, input.meetingId);
  const motion = await prisma.meetingMotion.create({
    data: {
      organizationId: input.organizationId,
      meetingId: input.meetingId,
      text,
      moverName: input.moverName?.trim() || null,
      seconderName: input.seconderName?.trim() || null,
      status: input.seconderName?.trim() ? "SECONDED" : "PROPOSED",
      createdByUserId: input.actorUserId,
    },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting.motion_recorded",
    entityType: "meeting_motion",
    entityId: motion.id,
    metadata: { meetingId: input.meetingId },
  });
  return motion;
}

/** "2026-014": year of the decision, then a per-org sequence within that
 * year. Allocated inside the decide transaction with a retry on the unique
 * constraint so concurrent passes can't collide or skip. */
async function allocateDecisionNumber(tx: { meetingMotion: { count: (args: object) => Promise<number> } }, organizationId: string, decidedAt: Date): Promise<string> {
  const year = decidedAt.getFullYear();
  const countThisYear = await tx.meetingMotion.count({
    where: { organizationId, decisionNumber: { startsWith: `${year}-` } },
  });
  return `${year}-${String(countThisYear + 1).padStart(3, "0")}`;
}

export async function decideMotion(input: {
  organizationId: string;
  motionId: string;
  status: "PASSED" | "FAILED" | "TABLED" | "WITHDRAWN" | "SECONDED";
  votesYes?: number | null;
  votesNo?: number | null;
  votesAbstain?: number | null;
  voteMethod?: string | null;
  discussionNotes?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}) {
  const motion = await prisma.meetingMotion.findFirst({ where: { id: input.motionId, organizationId: input.organizationId } });
  if (!motion) throw new MeetingOperationError("Motion not found.", 404);
  if (motion.status === "PASSED" || motion.status === "FAILED") {
    throw new MeetingOperationError("This motion has already been decided — record a new motion to revisit it.");
  }

  const decidedAt = new Date();
  const isTerminal = input.status === "PASSED" || input.status === "FAILED";

  // The unique (organizationId, decisionNumber) constraint is the real
  // arbiter under concurrency — on a collision we retry with a fresh count.
  let updated = null;
  for (let attempt = 0; attempt < 3 && !updated; attempt++) {
    try {
      updated = await prisma.$transaction(async (tx) => {
        const decisionNumber = input.status === "PASSED" ? await allocateDecisionNumber(tx, input.organizationId, decidedAt) : null;
        return tx.meetingMotion.update({
          where: { id: motion.id },
          data: {
            status: input.status,
            votesYes: input.votesYes ?? null,
            votesNo: input.votesNo ?? null,
            votesAbstain: input.votesAbstain ?? null,
            voteMethod: input.voteMethod?.trim() || motion.voteMethod,
            discussionNotes: input.discussionNotes?.trim() || motion.discussionNotes,
            ...(isTerminal ? { decidedAt } : {}),
            ...(decisionNumber ? { decisionNumber } : {}),
          },
        });
      });
    } catch (error) {
      const isUniqueViolation = typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
      if (!isUniqueViolation || attempt === 2) throw error;
    }
  }

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting.motion_decided",
    entityType: "meeting_motion",
    entityId: motion.id,
    metadata: { status: input.status, decisionNumber: updated!.decisionNumber, votes: { yes: input.votesYes, no: input.votesNo, abstain: input.votesAbstain } },
  });
  return updated!;
}

/** The Decision Register: every PASSED motion, newest first, searchable by
 * text or decision number. */
export async function listDecisions(organizationId: string, options: { search?: string } = {}) {
  const search = options.search?.trim();
  return prisma.meetingMotion.findMany({
    where: {
      organizationId,
      status: "PASSED",
      ...(search
        ? { OR: [{ text: { contains: search, mode: "insensitive" } }, { decisionNumber: { contains: search, mode: "insensitive" } }] }
        : {}),
    },
    orderBy: [{ decidedAt: "desc" }],
    include: { meeting: { select: { id: true, title: true, meetingDate: true } } },
    take: 200,
  });
}

// ─── Action items ────────────────────────────────────────────────────────────

export async function createActionItem(input: {
  organizationId: string;
  meetingId?: string | null;
  committeeId?: string | null;
  title: string;
  description?: string | null;
  ownerName?: string | null;
  dueDate?: Date | null;
  priority?: "LOW" | "NORMAL" | "HIGH";
  actorUserId: string;
  actorEmail?: string | null;
}) {
  const title = input.title.trim();
  if (!title) throw new MeetingOperationError("Action item title is required.");
  if (input.meetingId) await requireMeetingInOrg(input.organizationId, input.meetingId);
  if (input.committeeId) {
    const committee = await prisma.ptaCommittee.findFirst({ where: { id: input.committeeId, organizationId: input.organizationId } });
    if (!committee) throw new MeetingOperationError("Committee not found.", 404);
  }
  const item = await prisma.meetingActionItem.create({
    data: {
      organizationId: input.organizationId,
      meetingId: input.meetingId ?? null,
      committeeId: input.committeeId ?? null,
      title,
      description: input.description ?? null,
      ownerName: input.ownerName?.trim() || null,
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? "NORMAL",
      createdByUserId: input.actorUserId,
    },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting.action_item_created",
    entityType: "meeting_action_item",
    entityId: item.id,
    metadata: { title, meetingId: input.meetingId ?? null },
  });
  return item;
}

export async function updateActionItem(input: {
  organizationId: string;
  actionItemId: string;
  title?: string;
  description?: string | null;
  ownerName?: string | null;
  dueDate?: Date | null;
  priority?: "LOW" | "NORMAL" | "HIGH";
  status?: "OPEN" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED";
  actorUserId: string;
  actorEmail?: string | null;
}) {
  const existing = await prisma.meetingActionItem.findFirst({ where: { id: input.actionItemId, organizationId: input.organizationId } });
  if (!existing) throw new MeetingOperationError("Action item not found.", 404);

  const title = input.title?.trim();
  if (title !== undefined && !title) throw new MeetingOperationError("Action item title cannot be blank.");

  const becomingCompleted = input.status === "COMPLETED" && existing.status !== "COMPLETED";
  const item = await prisma.meetingActionItem.update({
    where: { id: existing.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.ownerName !== undefined ? { ownerName: input.ownerName?.trim() || null } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(becomingCompleted ? { completedAt: new Date() } : {}),
      ...(input.status !== undefined && input.status !== "COMPLETED" ? { completedAt: null } : {}),
    },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "meeting.action_item_updated",
    entityType: "meeting_action_item",
    entityId: item.id,
    metadata: { before: existing.status, after: item.status },
  });
  return item;
}

/** Open work, overdue first — the dashboard/report feed (wired into the PTA
 * dashboard in PTA-K; the Decisions page shows it meanwhile). */
export async function listOpenActionItems(organizationId: string) {
  return prisma.meetingActionItem.findMany({
    where: { organizationId, status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    include: { meeting: { select: { id: true, title: true } }, committee: { select: { id: true, name: true } } },
    take: 200,
  });
}
