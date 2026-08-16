import { Prisma } from "@prisma/client";
import type { UnionCase, UnionCaseStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/mail";
import { sendPushToTokens } from "@/lib/push";
import { UnionError } from "./errors";

/**
 * Union Case Center (UNION-CASE-A) — service layer. Every write goes
 * through here, never a raw `prisma.unionCase.update({ data: { status: ...
 * } })` at a call site, mirroring hoa/architectural-requests.ts's
 * established convention.
 *
 * Audit events use the exact action names the program spec requires
 * (UNION_CASE_CREATED, UNION_CASE_ASSIGNED, UNION_CASE_STATUS_CHANGED,
 * UNION_CASE_DEADLINE_CREATED, UNION_CASE_DEADLINE_COMPLETED,
 * UNION_CASE_RESOLVED, UNION_CASE_CLOSED). Metadata never carries case
 * narratives, comment bodies, or resolution text — only ids/enums/dates —
 * per the spec's explicit "do not log confidential notes" instruction.
 */

// ── State machine ─────────────────────────────────────────────────────────
//
// NEW is intake, not yet a formal grievance (see UnionCase.isFormalGrievance).
// TRIAGE is staff review before a rep is assigned. ASSIGNED means a rep is
// on the case but hasn't started active work. ACTIVE/PENDING split "I'm
// doing something" from "I'm waiting on someone else" (a management
// response, a hearing date). RESOLVED is an outcome reached, awaiting
// formal close; CLOSED and WITHDRAWN are terminal.
//
// Reassigning the rep (assignUnionCase) is deliberately NOT part of this
// state machine — it's a plain field update that only touches status when
// moving a case out of NEW/TRIAGE for the first time. See assignUnionCase.

const TRANSITIONS: Record<UnionCaseStatus, UnionCaseStatus[]> = {
  NEW: ["TRIAGE", "WITHDRAWN"],
  TRIAGE: ["ASSIGNED", "CLOSED", "WITHDRAWN"],
  ASSIGNED: ["ACTIVE", "TRIAGE", "WITHDRAWN"],
  ACTIVE: ["PENDING", "RESOLVED", "WITHDRAWN"],
  PENDING: ["ACTIVE", "RESOLVED", "WITHDRAWN"],
  RESOLVED: ["CLOSED", "ACTIVE"],
  CLOSED: [],
  WITHDRAWN: [],
};

export const TERMINAL_STATUSES: UnionCaseStatus[] = ["CLOSED", "WITHDRAWN"];

export function isTerminalStatus(status: UnionCaseStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function assertValidTransition(from: UnionCaseStatus, to: UnionCaseStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new UnionError(
      "UNION_CASE_INVALID_TRANSITION",
      `Cannot move a case from ${from} to ${to}. Valid next steps from ${from}: ${TRANSITIONS[from].join(", ") || "none (terminal)"}.`
    );
  }
}

// ── Intake (member-initiated, direct to NEW — no draft step) ───────────────

export async function createUnionCaseIntake(input: {
  organizationId: string;
  memberOrgMemberId: string;
  caseType: string;
  title: string;
  description: string;
  incidentDate?: Date | null;
  representationRequested?: boolean;
}): Promise<UnionCase> {
  const unionCase = await prisma.$transaction(async (tx) => {
    const created = await tx.unionCase.create({
      data: {
        organizationId: input.organizationId,
        memberOrgMemberId: input.memberOrgMemberId,
        caseType: input.caseType,
        title: input.title,
        description: input.description,
        incidentDate: input.incidentDate ?? null,
        representationRequested: input.representationRequested ?? false,
        status: "NEW",
      },
    });

    await tx.unionCaseStatusHistory.create({
      data: { organizationId: input.organizationId, caseId: created.id, fromStatus: null, toStatus: "NEW" },
    });

    return created;
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    action: "UNION_CASE_CREATED",
    entityType: "union_case",
    entityId: unionCase.id,
    metadata: { caseType: unionCase.caseType, memberOrgMemberId: unionCase.memberOrgMemberId },
  });

  return unionCase;
}

// ── Assignment (separate from the status machine — see note above) ─────────

/** Assigns/reassigns the steward or representative on a case. Moving a case
 * out of NEW/TRIAGE for the first time also advances status to ASSIGNED
 * (the natural "a rep is now on this" signal); reassigning a case that's
 * already ASSIGNED/ACTIVE/PENDING only changes the assignee, leaving status
 * untouched. */
export async function assignUnionCase(input: {
  organizationId: string;
  caseId: string;
  assignedToOrgMemberId: string;
  actorUserId: string;
}): Promise<UnionCase> {
  const assignee = await prisma.orgMember.findFirst({
    where: { id: input.assignedToOrgMemberId, organizationId: input.organizationId, membershipStatus: "active" },
    select: { id: true },
  });
  if (!assignee) {
    throw new UnionError("UNION_CASE_ASSIGNEE_NOT_FOUND", "The assignee must be an active member of this organization.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.unionCase.findFirst({ where: { id: input.caseId, organizationId: input.organizationId } });
    if (!existing) throw new UnionError("UNION_CASE_NOT_FOUND", "Case not found.");

    const bumpToAssigned = existing.status === "NEW" || existing.status === "TRIAGE";
    const nextStatus: UnionCaseStatus = bumpToAssigned ? "ASSIGNED" : existing.status;

    const { count } = await tx.unionCase.updateMany({
      where: { id: existing.id, organizationId: input.organizationId, status: existing.status },
      data: { assignedToOrgMemberId: input.assignedToOrgMemberId, status: nextStatus },
    });
    if (count === 0) {
      throw new UnionError("UNION_CASE_VALIDATION_ERROR", "This case was just updated. Refresh and try again.");
    }

    if (bumpToAssigned) {
      await tx.unionCaseStatusHistory.create({
        data: {
          organizationId: input.organizationId,
          caseId: existing.id,
          fromStatus: existing.status,
          toStatus: "ASSIGNED",
          changedByUserId: input.actorUserId,
        },
      });
    }

    return tx.unionCase.findUniqueOrThrow({ where: { id: existing.id } });
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "UNION_CASE_ASSIGNED",
    entityType: "union_case",
    entityId: updated.id,
    metadata: { assignedToOrgMemberId: input.assignedToOrgMemberId },
  });

  await notifyMemberSafely(input.organizationId, updated.memberOrgMemberId, {
    title: "A representative has been assigned to your case",
    body: `A steward or representative has been assigned to your case "${updated.title}".`,
    caseId: updated.id,
  });

  return updated;
}

// ── Status transitions (staff-initiated) ────────────────────────────────────
//
// Same two-phase shape as transitionArchitecturalRequestStatus: Phase 1
// (inside a $transaction) re-reads the case, validates the transition,
// applies it via a conditional updateMany() whose WHERE clause repeats the
// expected starting status (compare-and-swap), and writes the
// status-history row in the same transaction. Phase 2 (after commit) sends
// the member notification, wrapped in try/catch so a provider outage never
// rolls back or misreports an already-committed state change.

export async function transitionUnionCaseStatus(input: {
  organizationId: string;
  caseId: string;
  toStatus: UnionCaseStatus;
  actorUserId: string;
  notes?: string | null;
  resolutionSummary?: string | null;
}): Promise<UnionCase> {
  const isResolved = input.toStatus === "RESOLVED";
  const isClosed = input.toStatus === "CLOSED";

  const { updated, fromStatus } = await prisma.$transaction(async (tx) => {
    const existing = await tx.unionCase.findFirst({ where: { id: input.caseId, organizationId: input.organizationId } });
    if (!existing) throw new UnionError("UNION_CASE_NOT_FOUND", "Case not found.");
    assertValidTransition(existing.status, input.toStatus);

    const { count } = await tx.unionCase.updateMany({
      where: { id: existing.id, organizationId: input.organizationId, status: existing.status },
      data: {
        status: input.toStatus,
        resolvedAt: isResolved ? new Date() : undefined,
        resolutionSummary: isResolved && input.resolutionSummary !== undefined ? input.resolutionSummary : undefined,
        closedAt: isClosed ? new Date() : undefined,
      },
    });
    if (count === 0) {
      throw new UnionError("UNION_CASE_VALIDATION_ERROR", "This case was just updated by someone else. Refresh and try again.");
    }

    await tx.unionCaseStatusHistory.create({
      data: {
        organizationId: input.organizationId,
        caseId: existing.id,
        fromStatus: existing.status,
        toStatus: input.toStatus,
        changedByUserId: input.actorUserId,
        notes: input.notes ?? null,
      },
    });

    const refreshed = await tx.unionCase.findUniqueOrThrow({ where: { id: existing.id } });
    return { updated: refreshed, fromStatus: existing.status };
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: isResolved ? "UNION_CASE_RESOLVED" : isClosed ? "UNION_CASE_CLOSED" : "UNION_CASE_STATUS_CHANGED",
    entityType: "union_case",
    entityId: updated.id,
    metadata: { fromStatus, toStatus: input.toStatus },
  });

  await notifyMemberSafely(input.organizationId, updated.memberOrgMemberId, {
    title: "Your case status changed",
    body: `Your case "${updated.title}" status changed to "${formatStatusForMember(input.toStatus)}".`,
    caseId: updated.id,
  });

  return updated;
}

/** NEW/TRIAGE/ASSIGNED/ACTIVE/PENDING -> WITHDRAWN, member-initiated. */
export async function withdrawUnionCase(input: { organizationId: string; caseId: string; memberOrgMemberId: string }): Promise<UnionCase> {
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.unionCase.findFirst({ where: { id: input.caseId, organizationId: input.organizationId } });
    if (!existing) throw new UnionError("UNION_CASE_NOT_FOUND", "Case not found.");
    if (existing.memberOrgMemberId !== input.memberOrgMemberId) {
      throw new UnionError("UNION_CASE_NOT_YOURS", "You do not have access to this case.");
    }
    assertValidTransition(existing.status, "WITHDRAWN");

    const { count } = await tx.unionCase.updateMany({
      where: { id: existing.id, organizationId: input.organizationId, status: existing.status },
      data: { status: "WITHDRAWN", closedAt: new Date() },
    });
    if (count === 0) {
      throw new UnionError("UNION_CASE_VALIDATION_ERROR", "This case was just updated. Refresh and try again.");
    }

    await tx.unionCaseStatusHistory.create({
      data: { organizationId: input.organizationId, caseId: existing.id, fromStatus: existing.status, toStatus: "WITHDRAWN" },
    });

    return tx.unionCase.findUniqueOrThrow({ where: { id: existing.id } });
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    action: "UNION_CASE_STATUS_CHANGED",
    entityType: "union_case",
    entityId: updated.id,
    metadata: { toStatus: "WITHDRAWN" },
  });

  return updated;
}

// ── Notifications ────────────────────────────────────────────────────────

/** A case has exactly one interested member -- its owner -- so no fan-out
 * is needed. Never throws: logs and swallows delivery failures, same
 * reasoning as notifySubmitterSafely in architectural-requests.ts. */
async function notifyMemberSafely(
  organizationId: string,
  memberOrgMemberId: string,
  notification: { title: string; body: string; caseId: string }
): Promise<void> {
  try {
    const member = await prisma.orgMember.findFirst({
      where: { id: memberOrgMemberId, organizationId },
      select: { userId: true, email: true, commsEmailEnabled: true, commsPushEnabled: true },
    });
    if (!member) return;

    if (member.email && member.commsEmailEnabled) {
      await sendEmail({ to: member.email, subject: notification.title, text: notification.body });
    }
    if (member.userId && member.commsPushEnabled) {
      const tokens = await prisma.mobileDeviceToken.findMany({ where: { userId: member.userId }, select: { token: true } });
      if (tokens.length > 0) {
        await sendPushToTokens(
          tokens.map((t) => t.token),
          { title: notification.title, body: notification.body, deepLink: `/union-cases/${notification.caseId}` }
        );
      }
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "union_case_notification_failed",
        organizationId,
        caseId: notification.caseId,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

function formatStatusForMember(status: UnionCaseStatus): string {
  return status.replace(/_/g, " ").toLowerCase();
}

// ── Comments ─────────────────────────────────────────────────────────────

/** isPrivate defaults true at the schema level too -- callers must
 * explicitly opt in to a member-visible comment, never the reverse. This is
 * the security boundary between internal steward discussion and the member
 * API; see requireUnionCaseNotesInternal() for who may set isPrivate: true
 * and toMemberSafeUnionCaseComments() for the read-side filter. */
export async function addUnionCaseComment(input: {
  organizationId: string;
  caseId: string;
  body: string;
  isPrivate: boolean;
  actorUserId: string;
}) {
  const existing = await prisma.unionCase.findFirst({ where: { id: input.caseId, organizationId: input.organizationId } });
  if (!existing) throw new UnionError("UNION_CASE_NOT_FOUND", "Case not found.");

  return prisma.unionCaseComment.create({
    data: {
      organizationId: input.organizationId,
      caseId: input.caseId,
      authorUserId: input.actorUserId,
      body: input.body,
      isPrivate: input.isPrivate,
    },
  });
}

/** The ONLY function allowed to produce a member-facing comment list --
 * filters out every isPrivate comment before it ever reaches a serialized
 * response. Mirrors toResidentSafeArchitecturalRequest's comment filter. */
export function toMemberSafeUnionCaseComments(
  comments: { id: string; body: string; isPrivate: boolean; createdAt: Date }[]
): { id: string; body: string; createdAt: Date }[] {
  return comments.filter((c) => !c.isPrivate).map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt }));
}

// ── Contract references ─────────────────────────────────────────────────────

export async function addUnionCaseContractReference(input: {
  organizationId: string;
  caseId: string;
  reference: string;
  note?: string | null;
}) {
  const existing = await prisma.unionCase.findFirst({ where: { id: input.caseId, organizationId: input.organizationId } });
  if (!existing) throw new UnionError("UNION_CASE_NOT_FOUND", "Case not found.");

  return prisma.unionCaseContractReference.create({
    data: { organizationId: input.organizationId, caseId: input.caseId, reference: input.reference, note: input.note ?? null },
  });
}

// ── Deadlines ────────────────────────────────────────────────────────────
//
// No state machine here — a deadline is either open (completedAt: null) or
// completed. The (future UNION-CASE-D) reminder scanner reads dueAt/
// completedAt directly; this file only owns create/complete.

export async function addUnionCaseDeadline(input: {
  organizationId: string;
  caseId: string;
  deadlineType: string;
  description?: string | null;
  dueAt: Date;
  responsibleOrgMemberId?: string | null;
  actorUserId: string;
}) {
  const existing = await prisma.unionCase.findFirst({ where: { id: input.caseId, organizationId: input.organizationId } });
  if (!existing) throw new UnionError("UNION_CASE_NOT_FOUND", "Case not found.");

  const deadline = await prisma.unionCaseDeadline.create({
    data: {
      organizationId: input.organizationId,
      caseId: input.caseId,
      deadlineType: input.deadlineType,
      description: input.description ?? null,
      dueAt: input.dueAt,
      responsibleOrgMemberId: input.responsibleOrgMemberId ?? existing.assignedToOrgMemberId,
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "UNION_CASE_DEADLINE_CREATED",
    entityType: "union_case_deadline",
    entityId: deadline.id,
    metadata: { caseId: input.caseId, deadlineType: input.deadlineType, dueAt: input.dueAt.toISOString() },
  });

  return deadline;
}

export async function completeUnionCaseDeadline(input: { organizationId: string; deadlineId: string; actorUserId: string }) {
  const existing = await prisma.unionCaseDeadline.findFirst({ where: { id: input.deadlineId, organizationId: input.organizationId } });
  if (!existing) throw new UnionError("UNION_CASE_DEADLINE_NOT_FOUND", "Deadline not found.");

  const { count } = await prisma.unionCaseDeadline.updateMany({
    where: { id: existing.id, organizationId: input.organizationId, completedAt: null },
    data: { completedAt: new Date() },
  });
  if (count === 0) {
    throw new UnionError("UNION_CASE_VALIDATION_ERROR", "This deadline was already completed.");
  }

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "UNION_CASE_DEADLINE_COMPLETED",
    entityType: "union_case_deadline",
    entityId: existing.id,
    metadata: { caseId: existing.caseId, deadlineType: existing.deadlineType },
  });

  return prisma.unionCaseDeadline.findUniqueOrThrow({ where: { id: existing.id } });
}

// ── Staff reads ──────────────────────────────────────────────────────────

export async function listUnionCases(
  organizationId: string,
  filters: {
    status?: UnionCaseStatus;
    assignedToOrgMemberId?: string;
    unassigned?: boolean;
    caseType?: string;
    deadlineWindow?: "approaching" | "overdue";
    search?: string;
  }
) {
  const now = new Date();
  const approachingWindow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const searchTerm = filters.search?.trim();
  const searchAsNumber = searchTerm && /^\d+$/.test(searchTerm) ? Number(searchTerm) : undefined;

  return prisma.unionCase.findMany({
    where: {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      // unassigned takes priority over an explicit assignedToOrgMemberId --
      // the two are mutually exclusive dashboard-chip filters, never
      // combined by the UI.
      ...(filters.unassigned
        ? { assignedToOrgMemberId: null }
        : filters.assignedToOrgMemberId
          ? { assignedToOrgMemberId: filters.assignedToOrgMemberId }
          : {}),
      ...(filters.caseType ? { caseType: filters.caseType } : {}),
      ...(filters.deadlineWindow
        ? {
            deadlines: {
              some:
                filters.deadlineWindow === "overdue"
                  ? { completedAt: null, dueAt: { lt: now } }
                  : { completedAt: null, dueAt: { gte: now, lte: approachingWindow } },
            },
          }
        : {}),
      ...(searchTerm
        ? {
            OR: [
              ...(searchAsNumber !== undefined ? [{ caseNumber: searchAsNumber }] : []),
              { title: { contains: searchTerm, mode: "insensitive" as const } },
              { member: { firstName: { contains: searchTerm, mode: "insensitive" as const } } },
              { member: { lastName: { contains: searchTerm, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      member: { select: { id: true, firstName: true, lastName: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      deadlines: { where: { completedAt: null }, orderBy: { dueAt: "asc" }, take: 1, select: { dueAt: true } },
    },
  });
}

export interface UnionCaseDashboardCounts {
  newUnassigned: number;
  assignedToMe: number;
  active: number;
  pending: number;
  deadlinesApproaching: number;
  overdue: number;
  recentlyResolved: number;
}

/** Bucket counts for the steward/officer dashboard's quick-filter chips.
 * Deliberately just counts, not an analytics breakdown -- the dashboard
 * answers "what needs my attention today," nothing more. "Approaching"
 * means an open (not completed) deadline due within 7 days on a
 * non-terminal case; "overdue" is the same but already past due.
 * "Recently resolved" is RESOLVED or CLOSED in the last 14 days. */
export async function getUnionCaseDashboardCounts(organizationId: string, viewerOrgMemberId: string): Promise<UnionCaseDashboardCounts> {
  const now = new Date();
  const approachingWindow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const recentWindow = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [newUnassigned, assignedToMe, active, pending, deadlinesApproaching, overdue, recentlyResolved] = await Promise.all([
    prisma.unionCase.count({ where: { organizationId, status: { in: ["NEW", "TRIAGE"] }, assignedToOrgMemberId: null } }),
    prisma.unionCase.count({ where: { organizationId, assignedToOrgMemberId: viewerOrgMemberId, status: { notIn: TERMINAL_STATUSES } } }),
    prisma.unionCase.count({ where: { organizationId, status: "ACTIVE" } }),
    prisma.unionCase.count({ where: { organizationId, status: "PENDING" } }),
    prisma.unionCaseDeadline.count({
      where: { organizationId, completedAt: null, dueAt: { gte: now, lte: approachingWindow }, case: { status: { notIn: TERMINAL_STATUSES } } },
    }),
    prisma.unionCaseDeadline.count({
      where: { organizationId, completedAt: null, dueAt: { lt: now }, case: { status: { notIn: TERMINAL_STATUSES } } },
    }),
    prisma.unionCase.count({
      where: {
        organizationId,
        status: { in: ["RESOLVED", "CLOSED"] },
        OR: [{ resolvedAt: { gte: recentWindow } }, { closedAt: { gte: recentWindow } }],
      },
    }),
  ]);

  return { newUnassigned, assignedToMe, active, pending, deadlinesApproaching, overdue, recentlyResolved };
}

export type UnionCaseDashboardBucket =
  | "unassigned"
  | "assigned-to-me"
  | "active"
  | "pending"
  | "deadlines-approaching"
  | "overdue"
  | "recently-resolved";

const DASHBOARD_LIST_INCLUDE = {
  member: { select: { id: true, firstName: true, lastName: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  deadlines: { where: { completedAt: null }, orderBy: { dueAt: "asc" as const }, take: 1, select: { dueAt: true } },
};

/** The list backing each dashboard chip in getUnionCaseDashboardCounts --
 * same bucket definitions, kept in sync manually since one returns counts
 * and the other rows. Capped at 200 rows; this is a "what needs my
 * attention today" list, not a paginated archive. */
export async function listUnionCasesByBucket(organizationId: string, bucket: UnionCaseDashboardBucket, viewerOrgMemberId: string | null) {
  const now = new Date();
  const approachingWindow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const recentWindow = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  switch (bucket) {
    case "unassigned":
      return prisma.unionCase.findMany({
        where: { organizationId, status: { in: ["NEW", "TRIAGE"] }, assignedToOrgMemberId: null },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: DASHBOARD_LIST_INCLUDE,
      });
    case "assigned-to-me":
      if (!viewerOrgMemberId) return [];
      return prisma.unionCase.findMany({
        where: { organizationId, assignedToOrgMemberId: viewerOrgMemberId, status: { notIn: TERMINAL_STATUSES } },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: DASHBOARD_LIST_INCLUDE,
      });
    case "active":
      return prisma.unionCase.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 200, include: DASHBOARD_LIST_INCLUDE });
    case "pending":
      return prisma.unionCase.findMany({ where: { organizationId, status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 200, include: DASHBOARD_LIST_INCLUDE });
    case "deadlines-approaching":
      return prisma.unionCase.findMany({
        where: {
          organizationId,
          status: { notIn: TERMINAL_STATUSES },
          deadlines: { some: { completedAt: null, dueAt: { gte: now, lte: approachingWindow } } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: DASHBOARD_LIST_INCLUDE,
      });
    case "overdue":
      return prisma.unionCase.findMany({
        where: { organizationId, status: { notIn: TERMINAL_STATUSES }, deadlines: { some: { completedAt: null, dueAt: { lt: now } } } },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: DASHBOARD_LIST_INCLUDE,
      });
    case "recently-resolved":
      return prisma.unionCase.findMany({
        where: {
          organizationId,
          status: { in: ["RESOLVED", "CLOSED"] },
          OR: [{ resolvedAt: { gte: recentWindow } }, { closedAt: { gte: recentWindow } }],
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: DASHBOARD_LIST_INCLUDE,
      });
  }
}

export async function getUnionCaseDetail(organizationId: string, caseId: string) {
  const unionCase = await prisma.unionCase.findFirst({
    where: { id: caseId, organizationId },
    include: {
      member: { select: { id: true, firstName: true, lastName: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      comments: { orderBy: { createdAt: "desc" } },
      statusHistory: { orderBy: { createdAt: "desc" } },
      contractReferences: { orderBy: { createdAt: "desc" } },
      deadlines: { orderBy: { dueAt: "asc" } },
    },
  });
  if (!unionCase) throw new UnionError("UNION_CASE_NOT_FOUND", "Case not found.");
  return unionCase;
}

// ── Member-safe projection ───────────────────────────────────────────────

export interface MemberSafeUnionCase {
  id: string;
  caseNumber: number;
  caseType: string;
  title: string;
  description: string;
  status: UnionCaseStatus;
  isFormalGrievance: boolean;
  representationRequested: boolean;
  incidentDate: Date | null;
  openedAt: Date;
  resolvedAt: Date | null;
  resolutionSummary: string | null;
  closedAt: Date | null;
  assignedToOrgMemberId: string | null;
  createdAt: Date;
  updatedAt: Date;
  comments: { id: string; body: string; createdAt: Date }[];
  upcomingDates: { id: string; deadlineType: string; description: string | null; dueAt: Date }[];
}

/**
 * The ONLY function allowed to produce a member-facing case payload.
 * assignedToOrgMemberId is included as a plain id (not sensitive on its
 * own); resolving it to a display name is a route-layer concern, not this
 * function's. authorUserId, internal comments, contract references, and
 * responsibleOrgMemberId on deadlines never even reach the destructured
 * fields below, so a future field added to UnionCase without updating this
 * function stays excluded by default (opt-in inclusion, not opt-out
 * exclusion) -- mirrors toResidentSafeArchitecturalRequest exactly.
 */
export function toMemberSafeUnionCase(unionCase: {
  id: string;
  caseNumber: number;
  caseType: string;
  title: string;
  description: string;
  status: UnionCaseStatus;
  isFormalGrievance: boolean;
  representationRequested: boolean;
  incidentDate: Date | null;
  openedAt: Date;
  resolvedAt: Date | null;
  resolutionSummary: string | null;
  closedAt: Date | null;
  assignedToOrgMemberId: string | null;
  createdAt: Date;
  updatedAt: Date;
  comments?: { id: string; body: string; isPrivate: boolean; createdAt: Date }[];
  deadlines?: { id: string; deadlineType: string; description: string | null; dueAt: Date; completedAt: Date | null }[];
}): MemberSafeUnionCase {
  return {
    id: unionCase.id,
    caseNumber: unionCase.caseNumber,
    caseType: unionCase.caseType,
    title: unionCase.title,
    description: unionCase.description,
    status: unionCase.status,
    isFormalGrievance: unionCase.isFormalGrievance,
    representationRequested: unionCase.representationRequested,
    incidentDate: unionCase.incidentDate,
    openedAt: unionCase.openedAt,
    resolvedAt: unionCase.resolvedAt,
    resolutionSummary: unionCase.resolutionSummary,
    closedAt: unionCase.closedAt,
    assignedToOrgMemberId: unionCase.assignedToOrgMemberId,
    createdAt: unionCase.createdAt,
    updatedAt: unionCase.updatedAt,
    comments: toMemberSafeUnionCaseComments(unionCase.comments ?? []),
    upcomingDates: (unionCase.deadlines ?? [])
      .filter((d) => !d.completedAt)
      .map((d) => ({ id: d.id, deadlineType: d.deadlineType, description: d.description, dueAt: d.dueAt })),
  };
}

// ── Deadline reminders (UNION-CASE-C) ────────────────────────────────────
//
// Mirrors sendDeadlineReminders() in lib/hoa/violations.ts exactly: a
// dedicated dedup-log table's unique constraint IS the claim mechanism
// (INSERT, catch P2002 = "already sent"), not a preceding read -- safe
// under real concurrency (overlapping cron runs, retries, multiple app
// instances racing the same claim). dueOffsetDays = floor((dueAt - now) /
// 1 day) via absolute UTC epoch math, so it's timezone/DST-independent and
// naturally re-fires once per calendar day as a deadline gets closer (or,
// once overdue, further negative) -- a deliberately simple self-healing/
// escalation property rather than a separate retry or nagging schedule.
// Unlike Violations (which fans a single deadline out to every ACTIVE
// resident of a property), a UnionCaseDeadline has exactly one recipient
// -- its responsible party -- so there's no violation-level claim layer
// needed here, just the one per-(deadline, recipient, offset) claim.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEADLINE_REMINDER_TYPE = "DEADLINE_REMINDER";

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Never throws: logs and swallows delivery failures, same reasoning as
 * notifyMemberSafely above -- the claim row already committed, so a
 * transient failure gets a fresh chance once dueOffsetDays advances
 * tomorrow rather than looping forever today. Deep-links to the STAFF
 * detail page (/union/cases/[caseId]), unlike notifyMemberSafely's member
 * deep link -- the recipient here is always the responsible steward/rep,
 * never the case's own member. */
async function notifyResponsibleOrgMember(
  organizationId: string,
  orgMemberId: string,
  notification: { title: string; body: string; caseId: string }
): Promise<void> {
  try {
    const recipient = await prisma.orgMember.findFirst({
      where: { id: orgMemberId, organizationId },
      select: { userId: true, email: true, commsEmailEnabled: true, commsPushEnabled: true },
    });
    if (!recipient) return;

    if (recipient.email && recipient.commsEmailEnabled) {
      await sendEmail({ to: recipient.email, subject: notification.title, text: notification.body });
    }
    if (recipient.userId && recipient.commsPushEnabled) {
      const tokens = await prisma.mobileDeviceToken.findMany({ where: { userId: recipient.userId }, select: { token: true } });
      if (tokens.length > 0) {
        await sendPushToTokens(
          tokens.map((t) => t.token),
          { title: notification.title, body: notification.body, deepLink: `/union/cases/${notification.caseId}` }
        );
      }
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "union_case_deadline_reminder_notification_failed",
        organizationId,
        caseId: notification.caseId,
        orgMemberId,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

/**
 * Scans for open (not completed) deadlines on non-terminal cases due
 * within `reminderWindowDays`, or already overdue, and sends one reminder
 * to each deadline's responsible party -- called by a dedicated cron route
 * (src/app/api/cron/union-case-deadline-reminders/route.ts), mirroring
 * processPendingReminderLogs's cron-worker pattern.
 */
export async function sendUnionCaseDeadlineReminders(reminderWindowDays = 3): Promise<{ remindersSent: number }> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + reminderWindowDays * MS_PER_DAY);

  const dueSoon = await prisma.unionCaseDeadline.findMany({
    where: {
      completedAt: null,
      dueAt: { lte: windowEnd },
      case: { status: { notIn: TERMINAL_STATUSES } },
    },
    select: {
      id: true,
      organizationId: true,
      caseId: true,
      deadlineType: true,
      description: true,
      dueAt: true,
      responsibleOrgMemberId: true,
      case: { select: { assignedToOrgMemberId: true, caseNumber: true, title: true } },
    },
  });
  if (dueSoon.length === 0) return { remindersSent: 0 };

  let remindersSent = 0;
  for (const deadline of dueSoon) {
    const recipientOrgMemberId = deadline.responsibleOrgMemberId ?? deadline.case.assignedToOrgMemberId;
    if (!recipientOrgMemberId) continue; // no one to notify -- deadline predates assignment

    const dueOffsetDays = Math.floor((deadline.dueAt.getTime() - now.getTime()) / MS_PER_DAY);
    const overdue = dueOffsetDays < 0;

    try {
      await prisma.unionCaseDeadlineReminderLog.create({
        data: {
          organizationId: deadline.organizationId,
          deadlineId: deadline.id,
          orgMemberId: recipientOrgMemberId,
          reminderType: DEADLINE_REMINDER_TYPE,
          dueOffsetDays,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) continue; // already reminded this recipient for this offset
      throw error;
    }
    remindersSent++;

    const caseLabel = `UC-${deadline.case.caseNumber} ("${deadline.case.title}")`;
    const title = overdue ? "Overdue: Union case deadline" : "Union case deadline approaching";
    const body = overdue
      ? `${deadline.deadlineType} for ${caseLabel} was due ${deadline.dueAt.toLocaleDateString()} and is now overdue.`
      : `${deadline.deadlineType} for ${caseLabel} is due ${deadline.dueAt.toLocaleDateString()}.`;

    await notifyResponsibleOrgMember(deadline.organizationId, recipientOrgMemberId, { title, body, caseId: deadline.caseId });
  }

  return { remindersSent };
}
