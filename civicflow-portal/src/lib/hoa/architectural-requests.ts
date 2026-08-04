import { Prisma } from "@prisma/client";
import type { ArchitecturalRequest, ArchitecturalRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/mail";
import { sendPushToTokens } from "@/lib/push";
import { HoaError } from "./errors";

type TxClient = Prisma.TransactionClient;

/**
 * HOA Architectural Requests — service layer. Every write goes through
 * here, never a raw `prisma.architecturalRequest.update({ data: { status:
 * ... } })` at a call site, mirroring violations.ts's own established
 * convention for every other HOA stateful workflow.
 */

// ── State machine ─────────────────────────────────────────────────────────

const TRANSITIONS: Record<ArchitecturalRequestStatus, ArchitecturalRequestStatus[]> = {
  DRAFT: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["IN_REVIEW", "WITHDRAWN"],
  IN_REVIEW: ["CHANGES_REQUESTED", "APPROVED", "CONDITIONALLY_APPROVED", "DENIED"],
  CHANGES_REQUESTED: ["RESUBMITTED", "WITHDRAWN"],
  RESUBMITTED: ["IN_REVIEW"],
  APPROVED: ["EXPIRED"],
  CONDITIONALLY_APPROVED: ["EXPIRED"],
  DENIED: [],
  WITHDRAWN: [],
  EXPIRED: [],
};

const TERMINAL_STATUSES: ArchitecturalRequestStatus[] = ["APPROVED", "CONDITIONALLY_APPROVED", "DENIED", "WITHDRAWN", "EXPIRED"];

export function isTerminalStatus(status: ArchitecturalRequestStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function assertValidTransition(from: ArchitecturalRequestStatus, to: ArchitecturalRequestStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new HoaError(
      "HOA_ARCHITECTURAL_REQUEST_INVALID_TRANSITION",
      `Cannot move an architectural request from ${from} to ${to}. Valid next steps from ${from}: ${TRANSITIONS[from].join(", ") || "none (terminal)"}.`
    );
  }
}

// ── Create / edit (DRAFT only, resident-initiated) ──────────────────────

export async function createArchitecturalRequestDraft(input: {
  organizationId: string;
  propertyId: string;
  submittedByOrgMemberId: string;
  category: string;
  title: string;
  projectDescription: string;
  proposedStartDate?: Date | null;
  proposedCompletionDate?: Date | null;
}): Promise<ArchitecturalRequest> {
  const property = await prisma.property.findFirst({ where: { id: input.propertyId, organizationId: input.organizationId } });
  if (!property) throw new HoaError("HOA_PROPERTY_NOT_FOUND", "Property not found in this organization.");

  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.architecturalRequest.create({
      data: {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        submittedByOrgMemberId: input.submittedByOrgMemberId,
        category: input.category,
        title: input.title,
        projectDescription: input.projectDescription,
        proposedStartDate: input.proposedStartDate ?? null,
        proposedCompletionDate: input.proposedCompletionDate ?? null,
        status: "DRAFT",
      },
    });

    await tx.architecturalRequestStatusHistory.create({
      data: {
        organizationId: input.organizationId,
        requestId: created.id,
        fromStatus: null,
        toStatus: "DRAFT",
      },
    });

    return created;
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    action: "create",
    entityType: "hoa_architectural_request",
    entityId: request.id,
    metadata: { propertyId: input.propertyId, category: input.category },
  });

  return request;
}

/** Only a DRAFT request can be edited directly -- once submitted,
 * corrections happen through the CHANGES_REQUESTED -> RESUBMITTED cycle
 * (an append-only record of what happened), never a silent field edit,
 * mirroring updateViolationDraft's exact reasoning. */
export async function updateArchitecturalRequestDraft(input: {
  organizationId: string;
  requestId: string;
  submittedByOrgMemberId: string;
  category?: string;
  title?: string;
  projectDescription?: string;
  proposedStartDate?: Date | null;
  proposedCompletionDate?: Date | null;
}): Promise<ArchitecturalRequest> {
  const existing = await prisma.architecturalRequest.findFirst({ where: { id: input.requestId, organizationId: input.organizationId } });
  if (!existing) throw new HoaError("HOA_ARCHITECTURAL_REQUEST_NOT_FOUND", "Architectural request not found.");
  if (existing.submittedByOrgMemberId !== input.submittedByOrgMemberId) {
    throw new HoaError("HOA_ARCHITECTURAL_REQUEST_NOT_YOURS", "You do not have access to this architectural request.");
  }
  if (existing.status !== "DRAFT") {
    throw new HoaError(
      "HOA_ARCHITECTURAL_REQUEST_INVALID_TRANSITION",
      "Only a DRAFT request can be edited directly. Once submitted, respond to a change request or withdraw instead."
    );
  }

  return prisma.architecturalRequest.update({
    where: { id: input.requestId },
    data: {
      category: input.category ?? undefined,
      title: input.title ?? undefined,
      projectDescription: input.projectDescription ?? undefined,
      proposedStartDate: input.proposedStartDate === undefined ? undefined : input.proposedStartDate,
      proposedCompletionDate: input.proposedCompletionDate === undefined ? undefined : input.proposedCompletionDate,
    },
  });
}

// ── Transitions ────────────────────────────────────────────────────────────
//
// Every transition follows the same two-phase shape proven in
// violations.ts: Phase 1 (inside a $transaction) re-reads the request,
// validates the transition, applies it via a conditional updateMany()
// whose WHERE clause repeats the expected starting status (a
// compare-and-swap -- if a concurrent request already changed the status,
// count is 0 and this throws HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE
// instead of silently overwriting), and writes the status-history row in
// the same transaction. Phase 2 (after commit) sends the single-recipient
// notification, wrapped in try/catch so a provider outage never rolls back
// or misreports an already-committed state change.

async function recordTransitionTx(
  tx: TxClient,
  input: { organizationId: string; requestId: string; fromStatus: ArchitecturalRequestStatus; toStatus: ArchitecturalRequestStatus; actorUserId?: string | null; notes?: string | null }
): Promise<void> {
  await tx.architecturalRequestStatusHistory.create({
    data: {
      organizationId: input.organizationId,
      requestId: input.requestId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      changedByUserId: input.actorUserId ?? null,
      notes: input.notes ?? null,
    },
  });
}

type NotificationKind = "submitted" | "review_started" | "changes_requested" | "resubmitted" | "decided" | "withdrawn" | "expired";

/** Unlike Violations (which fans a notification out to every ACTIVE
 * resident of a property), an architectural request has exactly one
 * interested resident -- its submitter -- so there's no
 * resolveActivePropertyResidents-style fan-out needed here. Never throws:
 * logs and swallows delivery failures, same reasoning as
 * notifyPropertyResidentsSafely in violations.ts. */
async function notifySubmitterSafely(
  organizationId: string,
  submittedByOrgMemberId: string,
  notification: { kind: NotificationKind; title: string; body: string; requestId: string }
): Promise<void> {
  try {
    const submitter = await prisma.orgMember.findFirst({
      where: { id: submittedByOrgMemberId, organizationId },
      select: { userId: true, email: true, commsEmailEnabled: true, commsPushEnabled: true },
    });
    if (!submitter) return;

    if (submitter.email && submitter.commsEmailEnabled) {
      await sendEmail({ to: submitter.email, subject: notification.title, text: notification.body });
    }
    if (submitter.userId && submitter.commsPushEnabled) {
      const tokens = await prisma.mobileDeviceToken.findMany({ where: { userId: submitter.userId }, select: { token: true } });
      if (tokens.length > 0) {
        await sendPushToTokens(
          tokens.map((t) => t.token),
          {
            title: notification.title,
            body: notification.body,
            // No resident-facing per-request detail page ships in this MVP
            // (see docs/hoa-architectural-requests.md) -- /m/architectural-requests
            // is the only actually-reachable target, same reasoning as
            // violations.ts's equivalent deep-link comment.
            deepLink: "/m/architectural-requests",
          }
        );
      }
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "hoa_architectural_request_notification_failed",
        organizationId,
        requestId: notification.requestId,
        kind: notification.kind,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

function formatStatusForResident(status: ArchitecturalRequestStatus): string {
  return status.replace(/_/g, " ").toLowerCase();
}

/** DRAFT -> SUBMITTED, resident-initiated. The only transition triggered
 * by the submitter rather than an officer. */
export async function submitArchitecturalRequest(input: {
  organizationId: string;
  requestId: string;
  submittedByOrgMemberId: string;
}): Promise<ArchitecturalRequest> {
  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.architecturalRequest.findFirst({ where: { id: input.requestId, organizationId: input.organizationId } });
    if (!request) throw new HoaError("HOA_ARCHITECTURAL_REQUEST_NOT_FOUND", "Architectural request not found.");
    if (request.submittedByOrgMemberId !== input.submittedByOrgMemberId) {
      throw new HoaError("HOA_ARCHITECTURAL_REQUEST_NOT_YOURS", "You do not have access to this architectural request.");
    }
    assertValidTransition(request.status, "SUBMITTED");

    const { count } = await tx.architecturalRequest.updateMany({
      where: { id: request.id, organizationId: input.organizationId, status: request.status },
      data: { status: "SUBMITTED", submittedAt: new Date() },
    });
    if (count === 0) {
      throw new HoaError("HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE", "This request was just updated. Refresh and try again.");
    }

    await recordTransitionTx(tx, { organizationId: input.organizationId, requestId: request.id, fromStatus: request.status, toStatus: "SUBMITTED" });
    return tx.architecturalRequest.findUniqueOrThrow({ where: { id: request.id } });
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    action: "update",
    entityType: "hoa_architectural_request",
    entityId: updated.id,
    metadata: { fromStatus: "DRAFT", toStatus: "SUBMITTED" },
  });

  await notifySubmitterSafely(input.organizationId, input.submittedByOrgMemberId, {
    kind: "submitted",
    title: "Architectural request submitted",
    body: `Your request "${updated.title}" has been submitted for review.`,
    requestId: updated.id,
  });

  return updated;
}

/** DRAFT/SUBMITTED/CHANGES_REQUESTED -> WITHDRAWN, resident-initiated. */
export async function withdrawArchitecturalRequest(input: {
  organizationId: string;
  requestId: string;
  submittedByOrgMemberId: string;
}): Promise<ArchitecturalRequest> {
  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.architecturalRequest.findFirst({ where: { id: input.requestId, organizationId: input.organizationId } });
    if (!request) throw new HoaError("HOA_ARCHITECTURAL_REQUEST_NOT_FOUND", "Architectural request not found.");
    if (request.submittedByOrgMemberId !== input.submittedByOrgMemberId) {
      throw new HoaError("HOA_ARCHITECTURAL_REQUEST_NOT_YOURS", "You do not have access to this architectural request.");
    }
    assertValidTransition(request.status, "WITHDRAWN");

    const { count } = await tx.architecturalRequest.updateMany({
      where: { id: request.id, organizationId: input.organizationId, status: request.status },
      data: { status: "WITHDRAWN" },
    });
    if (count === 0) {
      throw new HoaError("HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE", "This request was just updated. Refresh and try again.");
    }

    await recordTransitionTx(tx, { organizationId: input.organizationId, requestId: request.id, fromStatus: request.status, toStatus: "WITHDRAWN" });
    return tx.architecturalRequest.findUniqueOrThrow({ where: { id: request.id } });
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    action: "update",
    entityType: "hoa_architectural_request",
    entityId: updated.id,
    metadata: { toStatus: "WITHDRAWN" },
  });

  return updated;
}

/** CHANGES_REQUESTED -> RESUBMITTED, resident-initiated. Optionally
 * updates the editable fields in the same transaction as the transition,
 * so a resubmission always reflects the fix, not a stale draft edit made
 * separately. */
export async function resubmitArchitecturalRequest(input: {
  organizationId: string;
  requestId: string;
  submittedByOrgMemberId: string;
  category?: string;
  title?: string;
  projectDescription?: string;
  proposedStartDate?: Date | null;
  proposedCompletionDate?: Date | null;
}): Promise<ArchitecturalRequest> {
  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.architecturalRequest.findFirst({ where: { id: input.requestId, organizationId: input.organizationId } });
    if (!request) throw new HoaError("HOA_ARCHITECTURAL_REQUEST_NOT_FOUND", "Architectural request not found.");
    if (request.submittedByOrgMemberId !== input.submittedByOrgMemberId) {
      throw new HoaError("HOA_ARCHITECTURAL_REQUEST_NOT_YOURS", "You do not have access to this architectural request.");
    }
    assertValidTransition(request.status, "RESUBMITTED");

    const { count } = await tx.architecturalRequest.updateMany({
      where: { id: request.id, organizationId: input.organizationId, status: request.status },
      data: {
        status: "RESUBMITTED",
        category: input.category ?? undefined,
        title: input.title ?? undefined,
        projectDescription: input.projectDescription ?? undefined,
        proposedStartDate: input.proposedStartDate === undefined ? undefined : input.proposedStartDate,
        proposedCompletionDate: input.proposedCompletionDate === undefined ? undefined : input.proposedCompletionDate,
      },
    });
    if (count === 0) {
      throw new HoaError("HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE", "This request was just updated. Refresh and try again.");
    }

    await recordTransitionTx(tx, { organizationId: input.organizationId, requestId: request.id, fromStatus: request.status, toStatus: "RESUBMITTED" });
    return tx.architecturalRequest.findUniqueOrThrow({ where: { id: request.id } });
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    action: "update",
    entityType: "hoa_architectural_request",
    entityId: updated.id,
    metadata: { fromStatus: "CHANGES_REQUESTED", toStatus: "RESUBMITTED" },
  });

  await notifySubmitterSafely(input.organizationId, input.submittedByOrgMemberId, {
    kind: "resubmitted",
    title: "Architectural request resubmitted",
    body: `Your resubmission for "${updated.title}" has been received.`,
    requestId: updated.id,
  });

  return updated;
}

/** Every officer-initiated transition: SUBMITTED/RESUBMITTED -> IN_REVIEW,
 * IN_REVIEW -> CHANGES_REQUESTED, IN_REVIEW -> APPROVED /
 * CONDITIONALLY_APPROVED / DENIED, APPROVED / CONDITIONALLY_APPROVED ->
 * EXPIRED. Permission tier (review vs. decide) is enforced by the route
 * layer choosing which guard to call before reaching this function, not
 * here -- mirrors transitionViolationStatus's separation of concerns. */
export async function transitionArchitecturalRequestStatus(input: {
  organizationId: string;
  requestId: string;
  toStatus: ArchitecturalRequestStatus;
  actorUserId: string;
  notes?: string | null;
  decisionSummary?: string | null;
  conditions?: string | null;
}): Promise<ArchitecturalRequest> {
  const terminal = isTerminalStatus(input.toStatus);
  const isDecision = input.toStatus === "APPROVED" || input.toStatus === "CONDITIONALLY_APPROVED" || input.toStatus === "DENIED";

  const { updated, fromStatus, submittedByOrgMemberId } = await prisma.$transaction(async (tx) => {
    const request = await tx.architecturalRequest.findFirst({ where: { id: input.requestId, organizationId: input.organizationId } });
    if (!request) throw new HoaError("HOA_ARCHITECTURAL_REQUEST_NOT_FOUND", "Architectural request not found.");
    assertValidTransition(request.status, input.toStatus);

    const { count } = await tx.architecturalRequest.updateMany({
      where: { id: request.id, organizationId: input.organizationId, status: request.status },
      data: {
        status: input.toStatus,
        decidedAt: isDecision ? new Date() : undefined,
        decidedByUserId: isDecision ? input.actorUserId : undefined,
        decisionSummary: isDecision && input.decisionSummary !== undefined ? input.decisionSummary : undefined,
        conditions: input.toStatus === "CONDITIONALLY_APPROVED" && input.conditions !== undefined ? input.conditions : undefined,
      },
    });
    if (count === 0) {
      throw new HoaError("HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE", "This request was just updated by someone else. Refresh and try again.");
    }

    await recordTransitionTx(tx, {
      organizationId: input.organizationId,
      requestId: request.id,
      fromStatus: request.status,
      toStatus: input.toStatus,
      actorUserId: input.actorUserId,
      notes: input.notes,
    });

    const updated = await tx.architecturalRequest.findUniqueOrThrow({ where: { id: request.id } });
    return { updated, fromStatus: request.status, submittedByOrgMemberId: request.submittedByOrgMemberId };
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "update",
    entityType: "hoa_architectural_request",
    entityId: updated.id,
    metadata: { fromStatus, toStatus: input.toStatus },
  });

  const kind: NotificationKind =
    input.toStatus === "IN_REVIEW" ? "review_started" : input.toStatus === "CHANGES_REQUESTED" ? "changes_requested" : isDecision ? "decided" : "expired";
  const title =
    input.toStatus === "IN_REVIEW"
      ? "Architectural request under review"
      : input.toStatus === "CHANGES_REQUESTED"
        ? "Changes requested on your architectural request"
        : terminal
          ? "Architectural request decision"
          : "Architectural request updated";
  const body = isDecision
    ? `Your request "${updated.title}" was ${formatStatusForResident(input.toStatus)}.${updated.conditions ? ` Conditions: ${updated.conditions}` : ""}`
    : `Your request "${updated.title}" status changed to "${formatStatusForResident(input.toStatus)}".`;

  await notifySubmitterSafely(input.organizationId, submittedByOrgMemberId, { kind, title, body, requestId: updated.id });

  return updated;
}

// ── Comments ─────────────────────────────────────────────────────────────

/** isPrivate defaults true at the schema level too -- callers must
 * explicitly opt in to a resident-visible comment, never the reverse. */
export async function addArchitecturalRequestComment(input: {
  organizationId: string;
  requestId: string;
  body: string;
  isPrivate: boolean;
  actorUserId: string;
}) {
  const request = await prisma.architecturalRequest.findFirst({ where: { id: input.requestId, organizationId: input.organizationId } });
  if (!request) throw new HoaError("HOA_ARCHITECTURAL_REQUEST_NOT_FOUND", "Architectural request not found.");

  return prisma.architecturalRequestComment.create({
    data: {
      organizationId: input.organizationId,
      requestId: input.requestId,
      authorUserId: input.actorUserId,
      body: input.body,
      isPrivate: input.isPrivate,
    },
  });
}

// ── Officer reads ────────────────────────────────────────────────────────

export async function listArchitecturalRequests(organizationId: string, filters: { propertyId?: string; status?: ArchitecturalRequestStatus }) {
  return prisma.architecturalRequest.findMany({
    where: {
      organizationId,
      ...(filters.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { property: { select: { id: true, addressLine1: true, unitLabel: true, displayName: true } } },
  });
}

export async function getArchitecturalRequestDetail(organizationId: string, requestId: string) {
  const request = await prisma.architecturalRequest.findFirst({
    where: { id: requestId, organizationId },
    include: {
      property: { select: { id: true, addressLine1: true, unitLabel: true, displayName: true } },
      comments: { orderBy: { createdAt: "desc" } },
      statusHistory: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!request) throw new HoaError("HOA_ARCHITECTURAL_REQUEST_NOT_FOUND", "Architectural request not found.");
  return request;
}

// ── Resident-safe projection ─────────────────────────────────────────────

export interface ResidentSafeArchitecturalRequest {
  id: string;
  propertyId: string;
  requestNumber: number;
  category: string;
  title: string;
  projectDescription: string;
  proposedStartDate: Date | null;
  proposedCompletionDate: Date | null;
  status: ArchitecturalRequestStatus;
  submittedAt: Date | null;
  decidedAt: Date | null;
  decisionSummary: string | null;
  conditions: string | null;
  expirationDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  comments: { id: string; body: string; createdAt: Date }[];
}

/**
 * The ONLY function allowed to produce a resident-facing request payload.
 * decidedByUserId and every private comment never even reach the
 * destructured fields below, so a future field added to ArchitecturalRequest
 * without updating this function stays excluded by default rather than
 * silently leaking (opt-in inclusion, not opt-out exclusion) -- mirrors
 * toResidentSafeViolation exactly.
 */
export function toResidentSafeArchitecturalRequest(request: {
  id: string;
  propertyId: string;
  requestNumber: number;
  category: string;
  title: string;
  projectDescription: string;
  proposedStartDate: Date | null;
  proposedCompletionDate: Date | null;
  status: ArchitecturalRequestStatus;
  submittedAt: Date | null;
  decidedAt: Date | null;
  decisionSummary: string | null;
  conditions: string | null;
  expirationDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  comments?: { id: string; body: string; isPrivate: boolean; createdAt: Date }[];
}): ResidentSafeArchitecturalRequest {
  return {
    id: request.id,
    propertyId: request.propertyId,
    requestNumber: request.requestNumber,
    category: request.category,
    title: request.title,
    projectDescription: request.projectDescription,
    proposedStartDate: request.proposedStartDate,
    proposedCompletionDate: request.proposedCompletionDate,
    status: request.status,
    submittedAt: request.submittedAt,
    decidedAt: request.decidedAt,
    decisionSummary: request.decisionSummary,
    conditions: request.conditions,
    expirationDate: request.expirationDate,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    comments: (request.comments ?? []).filter((c) => !c.isPrivate).map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt })),
  };
}
