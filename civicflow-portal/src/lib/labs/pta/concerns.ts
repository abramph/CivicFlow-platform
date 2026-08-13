import type { PtaConcernCategory, PtaConcernNoteKind, PtaConcernStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";

/**
 * PTA Vertical 2.0, PR PTA-E — Concerns & Grievances (docs/pta-vertical-2.md
 * §9). THE SECURITY MODULE for the vertical's most sensitive records.
 *
 * Access model, enforced HERE (never only in routes or UI):
 *  1. All entry points require a pta:concerns:* permission at the route
 *     layer — no base-admin or generic PTA permission grants anything.
 *  2. A case with isRestricted=true is readable/writable ONLY by its
 *     explicitly assigned officers (PtaConcernAssignee.userId), regardless
 *     of permissions. Everyone else gets at most a REDACTED stub (case
 *     number, category, status — never the title, people, or narrative),
 *     and only when they hold pta:concerns:assign (so reassignment remains
 *     possible without content exposure).
 *  3. Every detail read, mutation, assignment, status change, and
 *     resolution writes an audit event. Audit metadata never contains the
 *     description, reporter, or subject — only case number and status facts.
 *  4. Nothing here is reachable from any mobile or member-facing API.
 */

export interface ConcernViewer {
  userId: string;
  userEmail?: string | null;
  canView: boolean;
  canManage: boolean;
  canAssign: boolean;
  canResolve: boolean;
}

export interface RedactedConcern {
  id: string;
  caseNumber: string;
  category: PtaConcernCategory;
  status: PtaConcernStatus;
  isRestricted: true;
  submittedAt: Date;
  redacted: true;
}

function isAssignee(concern: { assignees: { userId: string }[] }, viewer: ConcernViewer): boolean {
  return concern.assignees.some((assignee) => assignee.userId === viewer.userId);
}

/** The single access decision for case CONTENT. */
export function canReadConcernContent(concern: { isRestricted: boolean; assignees: { userId: string }[] }, viewer: ConcernViewer): boolean {
  if (concern.isRestricted) return isAssignee(concern, viewer);
  return viewer.canView || isAssignee(concern, viewer);
}

/** Write access: managing a restricted case also requires assignment. */
export function canWriteConcern(concern: { isRestricted: boolean; assignees: { userId: string }[] }, viewer: ConcernViewer): boolean {
  if (concern.isRestricted) return isAssignee(concern, viewer) && (viewer.canManage || viewer.canResolve);
  return viewer.canManage || viewer.canResolve;
}

export async function ensureConcernsEnabled(organizationId: string) {
  const profile = await prisma.ptaProfile.findUnique({ where: { organizationId }, select: { concernsEnabled: true, concernsLabel: true } });
  if (profile && profile.concernsEnabled === false) {
    throw new PtaError("PTA_CONCERNS_DISABLED", "Concerns & Grievances is disabled for this organization.");
  }
  return { label: profile?.concernsLabel?.trim() || "Concerns & Grievances" };
}

/** "C-2026-001" — per org, per year, allocated inside the create transaction
 * with a retry on the unique constraint (mirrors the Decision Register). */
async function allocateCaseNumber(tx: { ptaConcern: { count: (args: object) => Promise<number> } }, organizationId: string): Promise<string> {
  const year = new Date().getFullYear();
  const countThisYear = await tx.ptaConcern.count({ where: { organizationId, caseNumber: { startsWith: `C-${year}-` } } });
  return `C-${year}-${String(countThisYear + 1).padStart(3, "0")}`;
}

export interface CreateConcernInput {
  organizationId: string;
  title: string;
  description: string;
  category?: PtaConcernCategory;
  isRestricted?: boolean;
  reporterName?: string | null;
  reporterContact?: string | null;
  subjectName?: string | null;
  incidentDate?: Date | null;
  responseDeadline?: Date | null;
  assignedCommitteeId?: string | null;
  applicableGovernanceDocumentId?: string | null;
  actor: ConcernViewer;
}

export async function createConcern(input: CreateConcernInput) {
  await ensureConcernsEnabled(input.organizationId);
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title) throw new PtaError("PTA_VALIDATION_ERROR", "A confidential title is required.");
  if (!description) throw new PtaError("PTA_VALIDATION_ERROR", "A description is required.");

  if (input.assignedCommitteeId) {
    const committee = await prisma.ptaCommittee.findFirst({ where: { id: input.assignedCommitteeId, organizationId: input.organizationId } });
    if (!committee) throw new PtaError("PTA_COMMITTEE_NOT_FOUND", "Committee not found in this organization.");
  }
  if (input.applicableGovernanceDocumentId) {
    const doc = await prisma.governanceDocument.findFirst({ where: { id: input.applicableGovernanceDocumentId, organizationId: input.organizationId } });
    if (!doc) throw new PtaError("PTA_VALIDATION_ERROR", "Referenced governing document not found.");
  }

  let concern = null;
  for (let attempt = 0; attempt < 3 && !concern; attempt++) {
    try {
      concern = await prisma.$transaction(async (tx) => {
        const caseNumber = await allocateCaseNumber(tx, input.organizationId);
        return tx.ptaConcern.create({
          data: {
            organizationId: input.organizationId,
            caseNumber,
            title,
            description,
            category: input.category ?? "OTHER",
            isRestricted: input.isRestricted ?? false,
            reporterName: input.reporterName?.trim() || null,
            reporterContact: input.reporterContact?.trim() || null,
            subjectName: input.subjectName?.trim() || null,
            incidentDate: input.incidentDate ?? null,
            responseDeadline: input.responseDeadline ?? null,
            assignedCommitteeId: input.assignedCommitteeId ?? null,
            applicableGovernanceDocumentId: input.applicableGovernanceDocumentId ?? null,
            createdByUserId: input.actor.userId,
          },
        });
      });
    } catch (error) {
      const isUniqueViolation = typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
      if (!isUniqueViolation || attempt === 2) throw error;
    }
  }

  // A restricted case starts readable by its creator — otherwise it would be
  // born unreachable by everyone.
  if (concern!.isRestricted) {
    await prisma.ptaConcernAssignee.create({
      data: { organizationId: input.organizationId, concernId: concern!.id, userId: input.actor.userId, assignedByUserId: input.actor.userId },
    });
  }

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorEmail: input.actor.userEmail ?? null,
    action: "pta.concern.created",
    entityType: "pta_concern",
    entityId: concern!.id,
    metadata: { caseNumber: concern!.caseNumber, category: concern!.category, isRestricted: concern!.isRestricted },
  });
  return concern!;
}

/** List for the case screen: full rows the viewer may read, plus redacted
 * stubs of restricted cases (only if the viewer can assign). */
export async function listConcerns(organizationId: string, viewer: ConcernViewer) {
  await ensureConcernsEnabled(organizationId);
  const rows = await prisma.ptaConcern.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "desc" }],
    include: { assignees: { select: { userId: true } } },
  });

  const readable = [];
  const redacted: RedactedConcern[] = [];
  for (const row of rows) {
    if (canReadConcernContent(row, viewer)) {
      readable.push(row);
    } else if (row.isRestricted && viewer.canAssign) {
      redacted.push({
        id: row.id,
        caseNumber: row.caseNumber,
        category: row.category,
        status: row.status,
        isRestricted: true,
        submittedAt: row.submittedAt,
        redacted: true,
      });
    }
    // Anything else: invisible entirely.
  }
  return { readable, redacted };
}

/** Detail read — audited. Restricted content only for assignees. */
export async function getConcern(organizationId: string, concernId: string, viewer: ConcernViewer) {
  await ensureConcernsEnabled(organizationId);
  const concern = await prisma.ptaConcern.findFirst({
    where: { id: concernId, organizationId },
    include: {
      assignees: { include: { user: { select: { id: true, email: true, displayName: true } } } },
      notes: { orderBy: { createdAt: "asc" }, include: { author: { select: { displayName: true, email: true } } } },
      assignedCommittee: { select: { id: true, name: true } },
      applicableGovernance: { select: { id: true, title: true, version: true } },
    },
  });
  if (!concern) throw new PtaError("PTA_CONCERN_NOT_FOUND", "Case not found.");
  if (!canReadConcernContent(concern, viewer)) {
    // Same message as not-found — existence of a restricted case's content
    // is not confirmed to unauthorized viewers beyond the redacted stub.
    throw new PtaError("PTA_CONCERN_NOT_FOUND", "Case not found.");
  }

  await createAuditEvent({
    organizationId,
    actorUserId: viewer.userId,
    actorEmail: viewer.userEmail ?? null,
    action: "pta.concern.viewed",
    entityType: "pta_concern",
    entityId: concern.id,
    metadata: { caseNumber: concern.caseNumber },
  });
  return concern;
}

export interface UpdateConcernInput {
  organizationId: string;
  concernId: string;
  status?: PtaConcernStatus;
  responseDeadline?: Date | null;
  assignedCommitteeId?: string | null;
  applicableGovernanceDocumentId?: string | null;
  isRestricted?: boolean;
  resolution?: string | null;
  appealNotes?: string | null;
  actor: ConcernViewer;
}

export async function updateConcern(input: UpdateConcernInput) {
  await ensureConcernsEnabled(input.organizationId);
  const existing = await prisma.ptaConcern.findFirst({
    where: { id: input.concernId, organizationId: input.organizationId },
    include: { assignees: { select: { userId: true } } },
  });
  if (!existing) throw new PtaError("PTA_CONCERN_NOT_FOUND", "Case not found.");
  if (!canWriteConcern(existing, input.actor)) throw new PtaError("PTA_CONCERN_NOT_FOUND", "Case not found.");

  const movingToResolution = input.status !== undefined && ["RESOLVED", "DISMISSED"].includes(input.status);
  if (movingToResolution && !input.actor.canResolve) {
    throw new PtaError("PTA_CONCERN_FORBIDDEN", "Resolving or dismissing a case requires the resolve permission.");
  }
  if (movingToResolution && !(input.resolution?.trim() || existing.resolution)) {
    throw new PtaError("PTA_VALIDATION_ERROR", "A resolution summary is required to resolve or dismiss a case.");
  }

  const concern = await prisma.ptaConcern.update({
    where: { id: existing.id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(movingToResolution ? { resolvedAt: new Date() } : {}),
      ...(input.responseDeadline !== undefined ? { responseDeadline: input.responseDeadline } : {}),
      ...(input.assignedCommitteeId !== undefined ? { assignedCommitteeId: input.assignedCommitteeId } : {}),
      ...(input.applicableGovernanceDocumentId !== undefined ? { applicableGovernanceDocumentId: input.applicableGovernanceDocumentId } : {}),
      ...(input.isRestricted !== undefined ? { isRestricted: input.isRestricted } : {}),
      ...(input.resolution !== undefined ? { resolution: input.resolution?.trim() || null } : {}),
      ...(input.appealNotes !== undefined ? { appealNotes: input.appealNotes?.trim() || null } : {}),
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorEmail: input.actor.userEmail ?? null,
    action: movingToResolution ? "pta.concern.resolved" : "pta.concern.updated",
    entityType: "pta_concern",
    entityId: concern.id,
    metadata: { caseNumber: existing.caseNumber, before: existing.status, after: concern.status },
  });
  return concern;
}

export async function assignConcernOfficer(input: {
  organizationId: string;
  concernId: string;
  userId: string;
  actor: ConcernViewer;
}) {
  await ensureConcernsEnabled(input.organizationId);
  if (!input.actor.canAssign) throw new PtaError("PTA_CONCERN_FORBIDDEN", "Assigning a case requires the assign permission.");
  const concern = await prisma.ptaConcern.findFirst({ where: { id: input.concernId, organizationId: input.organizationId } });
  if (!concern) throw new PtaError("PTA_CONCERN_NOT_FOUND", "Case not found.");

  // The assignee must actually be a staff member of this organization.
  const membership = await prisma.organizationMembership.findFirst({
    where: { organizationId: input.organizationId, userId: input.userId, status: "active", role: { not: "MEMBER" } },
  });
  if (!membership) throw new PtaError("PTA_VALIDATION_ERROR", "The assignee must be an officer of this organization.");

  const assignee = await prisma.ptaConcernAssignee.upsert({
    where: { concernId_userId: { concernId: concern.id, userId: input.userId } },
    create: { organizationId: input.organizationId, concernId: concern.id, userId: input.userId, assignedByUserId: input.actor.userId },
    update: {},
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorEmail: input.actor.userEmail ?? null,
    action: "pta.concern.assigned",
    entityType: "pta_concern",
    entityId: concern.id,
    metadata: { caseNumber: concern.caseNumber, assigneeUserId: input.userId },
  });
  return assignee;
}

export async function removeConcernAssignee(input: {
  organizationId: string;
  concernId: string;
  userId: string;
  actor: ConcernViewer;
}) {
  await ensureConcernsEnabled(input.organizationId);
  if (!input.actor.canAssign) throw new PtaError("PTA_CONCERN_FORBIDDEN", "Assigning a case requires the assign permission.");
  const concern = await prisma.ptaConcern.findFirst({
    where: { id: input.concernId, organizationId: input.organizationId },
    include: { assignees: { select: { userId: true } } },
  });
  if (!concern) throw new PtaError("PTA_CONCERN_NOT_FOUND", "Case not found.");
  if (concern.isRestricted && concern.assignees.length <= 1) {
    throw new PtaError("PTA_VALIDATION_ERROR", "A restricted case must keep at least one assigned officer.");
  }

  await prisma.ptaConcernAssignee.deleteMany({ where: { concernId: concern.id, userId: input.userId, organizationId: input.organizationId } });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorEmail: input.actor.userEmail ?? null,
    action: "pta.concern.unassigned",
    entityType: "pta_concern",
    entityId: concern.id,
    metadata: { caseNumber: concern.caseNumber, assigneeUserId: input.userId },
  });
}

export async function addConcernNote(input: {
  organizationId: string;
  concernId: string;
  kind?: PtaConcernNoteKind;
  body: string;
  actor: ConcernViewer;
}) {
  await ensureConcernsEnabled(input.organizationId);
  const body = input.body.trim();
  if (!body) throw new PtaError("PTA_VALIDATION_ERROR", "Note text is required.");
  const concern = await prisma.ptaConcern.findFirst({
    where: { id: input.concernId, organizationId: input.organizationId },
    include: { assignees: { select: { userId: true } } },
  });
  if (!concern) throw new PtaError("PTA_CONCERN_NOT_FOUND", "Case not found.");
  if (!canWriteConcern(concern, input.actor)) throw new PtaError("PTA_CONCERN_NOT_FOUND", "Case not found.");

  const note = await prisma.ptaConcernNote.create({
    data: {
      organizationId: input.organizationId,
      concernId: concern.id,
      kind: input.kind ?? "NOTE",
      body,
      authorUserId: input.actor.userId,
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    actorEmail: input.actor.userEmail ?? null,
    action: "pta.concern.note_added",
    entityType: "pta_concern",
    entityId: concern.id,
    metadata: { caseNumber: concern.caseNumber, kind: note.kind },
  });
  return note;
}
