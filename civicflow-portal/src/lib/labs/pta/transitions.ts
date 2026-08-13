import type { PtaHandoffStatus, PtaTransitionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { PtaError } from "./errors";
import { deriveNextLabel, resolveSchoolYearId } from "./school-years";

/**
 * PTA Vertical 2.0, PR PTA-F — Board Transition Center (docs/pta-vertical-2.md
 * PTA-F). The signature feature: a structured, scored handoff from one school
 * year's board to the next, built entirely on PTA-A's board machinery —
 * completing a transition activates INCOMING assignments through the same
 * transactional primitive the Board page uses, so leadership history lives in
 * exactly one place and the historical board is always preserved.
 *
 * §13 hard rule, enforced by construction: credentials are CHECKLIST LINES
 * ("confirm access transferred outside Unestra") — no password, account
 * number, or secret is ever stored.
 */

interface ActorInput {
  actorUserId: string;
  actorEmail?: string | null;
}

interface ChecklistTemplateItem {
  title: string;
  description?: string;
  isRequired?: boolean;
}

/** Position-specific handoff templates (§13), matched on the position name.
 * Deliberately data, not schema — organizations add custom items per handoff. */
const DEFAULT_TEMPLATE: ChecklistTemplateItem[] = [
  { title: "Write the handoff summary", description: "What the incoming officer needs to know: state of the role, open threads, key contacts." },
  { title: "Hand over documents", description: "Upload or point to the role's files in the Document Center (Transition folder)." },
  { title: "Introduce key contacts", description: "School administration, council/state contacts, vendors relevant to this role." },
  { title: "Review upcoming deadlines", description: "Anything due in the next 90 days that this role owns." },
  {
    title: "Confirm account access transferred outside Unestra",
    description: "Email accounts, shared drives, social media, and any logins. Unestra never stores passwords — transfer them directly and check this off.",
  },
];

const TEMPLATES: { match: RegExp; items: ChecklistTemplateItem[] }[] = [
  {
    match: /president/i,
    items: [
      { title: "Write the annual summary", description: "The year in review: major initiatives, outcomes, and outstanding issues." },
      { title: "Introduce school administration contacts", description: "Principal, office staff, and facility contacts." },
      { title: "Introduce council/state PTA contacts" },
      { title: "Review open action items and unresolved issues" },
      { title: "Review upcoming deadlines and recurring obligations" },
      {
        title: "Confirm account access transferred outside Unestra",
        description: "Email, website, social media, and any logins. Unestra never stores passwords — transfer them directly and check this off.",
      },
    ],
  },
  {
    match: /treasurer|finance/i,
    items: [
      { title: "Review the budget with the incoming treasurer" },
      { title: "Hand over financial reports", description: "Monthly reports, reconciliations, and the latest financial summary." },
      { title: "Complete the bank transition checklist", description: "Signature cards updated, outgoing signers removed, incoming signers added — at the bank, not in Unestra." },
      { title: "Review outstanding reimbursements and recurring payments" },
      { title: "Hand over audit/review and tax/compliance information", description: "Prior audits, EIN records, tax filings, insurance." },
      {
        title: "Confirm bank and account access transferred outside Unestra",
        description: "Unestra never stores banking credentials — transfer access directly and check this off.",
      },
    ],
  },
  {
    match: /secretary/i,
    items: [
      { title: "Confirm approved minutes are archived", description: "Every approved version lives in Meetings — nothing left on personal drives." },
      { title: "Hand over pending minutes and attendance records" },
      { title: "Hand over correspondence and governance records" },
      {
        title: "Confirm account access transferred outside Unestra",
        description: "Email and document accounts. Unestra never stores passwords — transfer them directly and check this off.",
      },
    ],
  },
  {
    match: /chair|coordinator/i,
    items: [
      { title: "Submit the committee report", description: "What the committee did, budget used, and recommendations for next year." },
      { title: "Hand over vendor contacts and event notes" },
      { title: "Review the committee budget" },
      { title: "Hand over committee documents" },
      {
        title: "Confirm account access transferred outside Unestra",
        description: "Unestra never stores passwords — transfer them directly and check this off.",
      },
    ],
  },
];

export function checklistTemplateForPosition(positionName: string): ChecklistTemplateItem[] {
  const template = TEMPLATES.find((entry) => entry.match.test(positionName));
  return template ? template.items : DEFAULT_TEMPLATE;
}

const TRANSITION_ORDER: PtaTransitionStatus[] = ["PREPARING", "READY_FOR_HANDOFF", "HANDOFF_IN_PROGRESS", "ACCEPTED", "COMPLETED"];

export async function listTransitions(organizationId: string) {
  return prisma.ptaBoardTransition.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      fromSchoolYear: { select: { id: true, label: true } },
      toSchoolYear: { select: { id: true, label: true } },
      handoffs: { select: { id: true, status: true } },
    },
  });
}

export interface CreateTransitionInput extends ActorInput {
  organizationId: string;
  /** Defaults to the current school year. */
  fromSchoolYearId?: string | null;
  /** Defaults to the year after fromYear (created if missing). */
  toSchoolYearId?: string | null;
  notes?: string | null;
}

/** Starts a transition and seeds one handoff (with its position-specific
 * checklist) per active board position, linking each position's sitting
 * ACTIVE assignment as the outgoing officer. */
export async function createTransition(input: CreateTransitionInput) {
  let fromYear = null;
  if (input.fromSchoolYearId) {
    fromYear = await prisma.ptaSchoolYear.findFirst({ where: { id: input.fromSchoolYearId, organizationId: input.organizationId } });
  } else {
    fromYear = await prisma.ptaSchoolYear.findFirst({ where: { organizationId: input.organizationId, isCurrent: true } });
  }
  if (!fromYear) throw new PtaError("PTA_SCHOOL_YEAR_NOT_FOUND", "Set a current school year before starting a transition.");

  let toYearId = input.toSchoolYearId ?? null;
  if (toYearId) {
    const toYear = await prisma.ptaSchoolYear.findFirst({ where: { id: toYearId, organizationId: input.organizationId } });
    if (!toYear) throw new PtaError("PTA_SCHOOL_YEAR_NOT_FOUND", "Incoming school year not found.");
  } else {
    const nextLabel = deriveNextLabel(fromYear.label);
    if (!nextLabel) throw new PtaError("PTA_VALIDATION_ERROR", `Cannot derive the next school year from "${fromYear.label}" — pick the incoming year explicitly.`);
    toYearId = await resolveSchoolYearId(input.organizationId, nextLabel);
    if (!toYearId) throw new PtaError("PTA_SCHOOL_YEAR_NOT_FOUND", "Unable to prepare the incoming school year.");
  }
  if (toYearId === fromYear.id) throw new PtaError("PTA_VALIDATION_ERROR", "A transition must move to a different school year.");

  const existing = await prisma.ptaBoardTransition.findFirst({
    where: { organizationId: input.organizationId, fromSchoolYearId: fromYear.id, toSchoolYearId: toYearId },
  });
  if (existing) throw new PtaError("PTA_VALIDATION_ERROR", "A transition between these school years already exists.");

  const positions = await prisma.ptaBoardPosition.findMany({
    where: { organizationId: input.organizationId, isActive: true },
    orderBy: { sortOrder: "asc" },
    include: { assignments: { where: { status: "ACTIVE" }, take: 1, orderBy: { createdAt: "desc" } } },
  });

  const transition = await prisma.$transaction(async (tx) => {
    const created = await tx.ptaBoardTransition.create({
      data: {
        organizationId: input.organizationId,
        fromSchoolYearId: fromYear.id,
        toSchoolYearId: toYearId!,
        notes: input.notes?.trim() || null,
        startedByUserId: input.actorUserId,
      },
    });
    for (const position of positions) {
      const handoff = await tx.ptaOfficerHandoff.create({
        data: {
          organizationId: input.organizationId,
          transitionId: created.id,
          positionId: position.id,
          outgoingAssignmentId: position.assignments[0]?.id ?? null,
        },
      });
      const template = checklistTemplateForPosition(position.name);
      await tx.ptaHandoffChecklistItem.createMany({
        data: template.map((item, index) => ({
          organizationId: input.organizationId,
          handoffId: handoff.id,
          title: item.title,
          description: item.description ?? null,
          isRequired: item.isRequired ?? true,
          sortOrder: index,
        })),
      });
    }
    return created;
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.transition.started",
    entityType: "pta_board_transition",
    entityId: transition.id,
    metadata: { fromYear: fromYear.label, positions: positions.length },
  });
  return transition;
}

export async function getTransitionDetail(organizationId: string, transitionId: string) {
  const transition = await prisma.ptaBoardTransition.findFirst({
    where: { id: transitionId, organizationId },
    include: {
      fromSchoolYear: { select: { id: true, label: true } },
      toSchoolYear: { select: { id: true, label: true } },
      handoffs: {
        orderBy: { createdAt: "asc" },
        include: {
          position: { select: { id: true, name: true, sortOrder: true } },
          outgoingAssignment: { select: { id: true, personName: true, status: true, householdAdult: { select: { name: true } } } },
          incomingAssignment: { select: { id: true, personName: true, status: true, householdAdult: { select: { name: true } } } },
          checklistItems: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });
  if (!transition) throw new PtaError("PTA_TRANSITION_NOT_FOUND", "Transition not found.");
  return transition;
}

export interface ReadinessCheck {
  label: string;
  done: boolean;
}

export interface ReadinessReport {
  score: number;
  completed: string[];
  missing: string[];
}

/** The brief's "Board Transition Readiness — 78%" (§12): pure math over the
 * transition detail plus two org-level governance facts, never stored. */
export function computeReadiness(
  transition: {
    handoffs: {
      position: { name: string };
      incomingAssignmentId: string | null;
      status: PtaHandoffStatus;
      checklistItems: { isRequired: boolean; completedAt: Date | null }[];
    }[];
  },
  orgFacts: { hasCurrentBylaws: boolean; hasApprovedMinutes: boolean }
): ReadinessReport {
  const checks: ReadinessCheck[] = [];
  for (const handoff of transition.handoffs) {
    const name = handoff.position.name;
    checks.push({ label: `${name}: incoming officer identified`, done: Boolean(handoff.incomingAssignmentId) });
    const required = handoff.checklistItems.filter((item) => item.isRequired);
    checks.push({
      label: `${name}: handoff checklist complete`,
      done: required.length === 0 || required.every((item) => item.completedAt !== null),
    });
    checks.push({ label: `${name}: handoff accepted`, done: handoff.status === "ACCEPTED" });
  }
  checks.push({ label: "Bylaws published and current", done: orgFacts.hasCurrentBylaws });
  checks.push({ label: "Meeting minutes approved and archived", done: orgFacts.hasApprovedMinutes });

  const done = checks.filter((check) => check.done);
  const score = checks.length === 0 ? 0 : Math.round((done.length / checks.length) * 100);
  return {
    score,
    completed: done.map((check) => check.label),
    missing: checks.filter((check) => !check.done).map((check) => check.label),
  };
}

export async function getOrgReadinessFacts(organizationId: string) {
  const [bylaws, approvedMinutes] = await Promise.all([
    prisma.governanceDocument.findFirst({ where: { organizationId, docType: "BYLAWS", status: "CURRENT" }, select: { id: true } }),
    prisma.meetingMinutes.findFirst({ where: { organizationId, status: "APPROVED" }, select: { id: true } }),
  ]);
  return { hasCurrentBylaws: Boolean(bylaws), hasApprovedMinutes: Boolean(approvedMinutes) };
}

export interface UpdateTransitionInput extends ActorInput {
  organizationId: string;
  transitionId: string;
  status?: PtaTransitionStatus;
  notes?: string | null;
}

/**
 * Status moves are free BETWEEN the pre-completion stages (a board can go
 * back to PREPARING); COMPLETED is the guarded ceremony: every handoff must
 * be ACCEPTED, then all linked INCOMING assignments activate (ending the
 * outgoing holders — history preserved), the current school year flips to
 * the incoming year, and the transition becomes terminal.
 */
export async function updateTransition(input: UpdateTransitionInput) {
  const transition = await getTransitionDetail(input.organizationId, input.transitionId);
  if (transition.status === "COMPLETED") {
    throw new PtaError("PTA_VALIDATION_ERROR", "A completed transition is a historical record and can no longer change.");
  }

  if (input.status === undefined || input.status === transition.status) {
    if (input.notes !== undefined) {
      await prisma.ptaBoardTransition.update({ where: { id: transition.id }, data: { notes: input.notes?.trim() || null } });
    }
    return getTransitionDetail(input.organizationId, input.transitionId);
  }

  if (!TRANSITION_ORDER.includes(input.status)) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Unknown transition status.");
  }

  if (input.status === "COMPLETED") {
    const notAccepted = transition.handoffs.filter((handoff) => handoff.status !== "ACCEPTED");
    if (notAccepted.length > 0) {
      throw new PtaError(
        "PTA_VALIDATION_ERROR",
        `Every handoff must be accepted before completing the transition (${notAccepted.length} outstanding).`
      );
    }

    const incomingIds = transition.handoffs
      .map((handoff) => handoff.incomingAssignment)
      .filter((assignment): assignment is NonNullable<typeof assignment> => assignment !== null && assignment.status === "INCOMING")
      .map((assignment) => assignment.id);

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      for (const handoff of transition.handoffs) {
        const incoming = handoff.incomingAssignment;
        if (!incoming || !incomingIds.includes(incoming.id)) continue;
        // Same semantics as board.ts activateOfficerAssignment: END the
        // sitting holder (never delete), then seat the incoming one.
        await tx.ptaOfficerAssignment.updateMany({
          where: { organizationId: input.organizationId, positionId: handoff.position.id, status: "ACTIVE" },
          data: { status: "ENDED", endDate: now },
        });
        await tx.ptaOfficerAssignment.update({ where: { id: incoming.id }, data: { status: "ACTIVE", startDate: now } });
      }
      // Flip the current school year (unset-then-set + profile label sync,
      // matching school-years.ts setCurrentSchoolYear).
      await tx.ptaSchoolYear.updateMany({
        where: { organizationId: input.organizationId, isCurrent: true, id: { not: transition.toSchoolYearId } },
        data: { isCurrent: false },
      });
      await tx.ptaSchoolYear.update({ where: { id: transition.toSchoolYearId }, data: { isCurrent: true } });
      await tx.ptaProfile.updateMany({
        where: { organizationId: input.organizationId },
        data: { currentSchoolYear: transition.toSchoolYear.label },
      });
      await tx.ptaBoardTransition.update({
        where: { id: transition.id },
        data: { status: "COMPLETED", completedAt: now, ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}) },
      });
    });

    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail ?? null,
      action: "pta.transition.completed",
      entityType: "pta_board_transition",
      entityId: transition.id,
      metadata: { fromYear: transition.fromSchoolYear.label, toYear: transition.toSchoolYear.label, officersActivated: incomingIds.length },
    });
    return getTransitionDetail(input.organizationId, input.transitionId);
  }

  await prisma.ptaBoardTransition.update({
    where: { id: transition.id },
    data: { status: input.status, ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}) },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.transition.status_changed",
    entityType: "pta_board_transition",
    entityId: transition.id,
    metadata: { before: transition.status, after: input.status },
  });
  return getTransitionDetail(input.organizationId, input.transitionId);
}

export interface UpdateHandoffInput extends ActorInput {
  organizationId: string;
  handoffId: string;
  status?: PtaHandoffStatus;
  notes?: string | null;
  /** Must be an INCOMING assignment for the same position. Null clears. */
  incomingAssignmentId?: string | null;
}

export async function updateHandoff(input: UpdateHandoffInput) {
  const handoff = await prisma.ptaOfficerHandoff.findFirst({
    where: { id: input.handoffId, organizationId: input.organizationId },
    include: {
      position: { select: { id: true, name: true } },
      transition: { select: { id: true, status: true } },
      checklistItems: true,
    },
  });
  if (!handoff) throw new PtaError("PTA_HANDOFF_NOT_FOUND", "Handoff not found.");
  if (handoff.transition.status === "COMPLETED") {
    throw new PtaError("PTA_VALIDATION_ERROR", "This transition is completed — its handoffs are historical records.");
  }

  if (input.incomingAssignmentId) {
    const incoming = await prisma.ptaOfficerAssignment.findFirst({
      where: { id: input.incomingAssignmentId, organizationId: input.organizationId, positionId: handoff.position.id },
    });
    if (!incoming) throw new PtaError("PTA_OFFICER_ASSIGNMENT_NOT_FOUND", "Incoming assignment not found for this position.");
    if (incoming.status === "ENDED") throw new PtaError("PTA_VALIDATION_ERROR", "An ended assignment cannot be the incoming officer.");
  }

  let acceptedAt: Date | null | undefined = undefined;
  if (input.status === "ACCEPTED") {
    const incomingId = input.incomingAssignmentId !== undefined ? input.incomingAssignmentId : handoff.incomingAssignmentId;
    if (!incomingId) throw new PtaError("PTA_VALIDATION_ERROR", "Identify the incoming officer before accepting the handoff.");
    const required = handoff.checklistItems.filter((item) => item.isRequired);
    if (!required.every((item) => item.completedAt !== null)) {
      throw new PtaError("PTA_VALIDATION_ERROR", "Complete every required checklist item before accepting the handoff.");
    }
    acceptedAt = new Date();
  } else if (input.status !== undefined && handoff.status === "ACCEPTED") {
    acceptedAt = null; // reopening an accepted handoff clears the acceptance stamp
  }

  const updated = await prisma.ptaOfficerHandoff.update({
    where: { id: handoff.id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(acceptedAt !== undefined ? { acceptedAt } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      ...(input.incomingAssignmentId !== undefined ? { incomingAssignmentId: input.incomingAssignmentId } : {}),
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: input.status === "ACCEPTED" ? "pta.transition.handoff_accepted" : "pta.transition.handoff_updated",
    entityType: "pta_officer_handoff",
    entityId: handoff.id,
    metadata: { position: handoff.position.name, before: handoff.status, after: updated.status },
  });
  return updated;
}

export async function setChecklistItemCompletion(input: ActorInput & { organizationId: string; itemId: string; completed: boolean }) {
  const item = await prisma.ptaHandoffChecklistItem.findFirst({
    where: { id: input.itemId, organizationId: input.organizationId },
    include: { handoff: { select: { id: true, transition: { select: { status: true } }, position: { select: { name: true } } } } },
  });
  if (!item) throw new PtaError("PTA_HANDOFF_NOT_FOUND", "Checklist item not found.");
  if (item.handoff.transition.status === "COMPLETED") {
    throw new PtaError("PTA_VALIDATION_ERROR", "This transition is completed — its checklists are historical records.");
  }

  const updated = await prisma.ptaHandoffChecklistItem.update({
    where: { id: item.id },
    data: input.completed ? { completedAt: new Date(), completedByUserId: input.actorUserId } : { completedAt: null, completedByUserId: null },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: input.completed ? "pta.transition.checklist_completed" : "pta.transition.checklist_reopened",
    entityType: "pta_handoff_checklist_item",
    entityId: item.id,
    metadata: { position: item.handoff.position.name, title: item.title },
  });
  return updated;
}

export async function addChecklistItem(input: ActorInput & { organizationId: string; handoffId: string; title: string; description?: string | null; isRequired?: boolean }) {
  const title = input.title.trim();
  if (!title) throw new PtaError("PTA_VALIDATION_ERROR", "Checklist item title is required.");
  const handoff = await prisma.ptaOfficerHandoff.findFirst({
    where: { id: input.handoffId, organizationId: input.organizationId },
    include: { transition: { select: { status: true } }, checklistItems: { select: { sortOrder: true } }, position: { select: { name: true } } },
  });
  if (!handoff) throw new PtaError("PTA_HANDOFF_NOT_FOUND", "Handoff not found.");
  if (handoff.transition.status === "COMPLETED") {
    throw new PtaError("PTA_VALIDATION_ERROR", "This transition is completed — its checklists are historical records.");
  }

  const nextOrder = handoff.checklistItems.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
  const item = await prisma.ptaHandoffChecklistItem.create({
    data: {
      organizationId: input.organizationId,
      handoffId: input.handoffId,
      title,
      description: input.description?.trim() || null,
      isRequired: input.isRequired ?? true,
      sortOrder: nextOrder,
    },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "pta.transition.checklist_item_added",
    entityType: "pta_handoff_checklist_item",
    entityId: item.id,
    metadata: { position: handoff.position.name, title },
  });
  return item;
}
