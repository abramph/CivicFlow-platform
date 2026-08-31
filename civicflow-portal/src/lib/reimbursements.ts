import { Prisma, type ReimbursementStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { FinanceError } from "@/lib/finance-errors";

/**
 * PTA Vertical 2.0, PR PTA-H — the reimbursement workflow (core;
 * docs/pta-vertical-2.md PTA-H), hardened by
 * fix/pta-treasurer-financial-controls (docs/pta-treasurer-financial-controls.md).
 *
 * SUBMITTED → UNDER_REVIEW → APPROVED → PAID → (VOIDED | REVERSED);
 * REJECTED from any pre-PAID state. REJECTED/VOIDED/REVERSED are terminal
 * (a resubmission, or a fresh correction of a *different* paid request, is
 * always a new/separate record — nothing here is ever deleted).
 *
 * Segregation of duties, enforced server-side regardless of role (no
 * ORG_OWNER/SUPER_ADMIN bypass in this ordinary workflow — emergency
 * platform-admin repair, if ever needed, is a separately audited process,
 * not this route): the submitter can never be the actor who approves,
 * pays, voids, or reverses their own request.
 *
 * PAID, VOIDED, and REVERSED are the three transitions that move real
 * ledger state (they create or void a linked Expenditure), so all three use
 * a conditional `updateMany` compare-and-swap — re-checking the current
 * status *inside* the same transaction that writes it — instead of the
 * read-then-write race the pre-hardening code used. A losing concurrent
 * caller gets a stable 409 and never creates or double-voids anything; the
 * audit event for each of the three is written with the same `tx` handle,
 * so an audit failure rolls back the money-moving write too.
 *
 * No bank credentials, account numbers, or payment rails — recording an
 * external payment (or its later cancellation/return) is all "paying" or
 * "reversing" ever means here. Unestra never claims to have moved or
 * recovered money itself.
 */

interface ActorInput {
  actorUserId: string;
  actorEmail?: string | null;
}

const ALLOWED_TRANSITIONS: Record<ReimbursementStatus, ReimbursementStatus[]> = {
  SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "SUBMITTED"],
  APPROVED: ["PAID", "REJECTED", "UNDER_REVIEW"],
  PAID: ["VOIDED", "REVERSED"],
  REJECTED: [],
  VOIDED: [],
  REVERSED: [],
};

/** Statuses where the submitter must not be the sole authorizing actor,
 * even if they separately hold reimbursements:manage. Rejecting your own
 * request isn't a self-dealing risk (it only ever harms you), so REJECTED
 * is deliberately not in this set. */
const SELF_ACTOR_RESTRICTED = new Set<ReimbursementStatus>(["APPROVED", "PAID", "VOIDED", "REVERSED"]);
const SELF_ACTOR_MESSAGES: Partial<Record<ReimbursementStatus, string>> = {
  APPROVED: "You cannot approve your own reimbursement request.",
  PAID: "You cannot mark your own reimbursement request paid.",
  VOIDED: "You cannot void your own reimbursement request.",
  REVERSED: "You cannot reverse your own reimbursement request.",
};

/** The literal word an actor must type to void/reverse a paid
 * reimbursement — a lightweight typed-confirmation gate for an action that
 * (unlike approve/reject) reverses money already recorded as paid. */
const CONFIRM_TEXT: Partial<Record<ReimbursementStatus, string>> = { VOIDED: "VOID", REVERSED: "REVERSE" };

function humanize(status: string): string {
  return status.toLowerCase().replaceAll("_", " ");
}

/** Internal marker: thrown when a conditional updateMany claims 0 rows,
 * i.e. another request already won the transition. Never leaves this
 * module — callers only ever see the resulting stable FinanceError(409). */
class ClaimLostError extends Error {}

export interface CreateReimbursementInput extends ActorInput {
  organizationId: string;
  payeeName: string;
  description: string;
  amount: number;
  categoryId?: string | null;
  eventId?: string | null;
  committeeId?: string | null;
}

export async function createReimbursement(input: CreateReimbursementInput) {
  const payeeName = input.payeeName.trim();
  const description = input.description.trim();
  if (!payeeName) throw new FinanceError("Who should be paid back? Payee is required.");
  if (!description) throw new FinanceError("Describe what the money was spent on.");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new FinanceError("Amount must be greater than zero.");

  if (input.categoryId) {
    const category = await prisma.category.findFirst({ where: { id: input.categoryId, organizationId: input.organizationId, type: "EXPENDITURE" } });
    if (!category) throw new FinanceError("Category not found.", 404);
  }
  if (input.eventId) {
    const event = await prisma.event.findFirst({ where: { id: input.eventId, organizationId: input.organizationId } });
    if (!event) throw new FinanceError("Event not found.", 404);
  }
  if (input.committeeId) {
    const committee = await prisma.ptaCommittee.findFirst({ where: { id: input.committeeId, organizationId: input.organizationId } });
    if (!committee) throw new FinanceError("Committee not found.", 404);
  }

  // Configurable review threshold (§20): above it, the request starts
  // flagged for review rather than plain SUBMITTED.
  const settings = await prisma.orgSettings.findUnique({
    where: { organizationId: input.organizationId },
    select: { reimbursementApprovalThreshold: true },
  });
  const threshold = settings?.reimbursementApprovalThreshold;
  const status: ReimbursementStatus = threshold !== null && threshold !== undefined && input.amount > Number(threshold) ? "UNDER_REVIEW" : "SUBMITTED";

  return prisma.$transaction(async (tx) => {
    const request = await tx.reimbursementRequest.create({
      data: {
        organizationId: input.organizationId,
        submittedByUserId: input.actorUserId,
        payeeName,
        description,
        amount: new Prisma.Decimal(input.amount.toFixed(2)),
        categoryId: input.categoryId ?? null,
        eventId: input.eventId ?? null,
        committeeId: input.committeeId ?? null,
        status,
      },
    });
    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail ?? null,
      action: "reimbursement.submitted",
      entityType: "reimbursement_request",
      entityId: request.id,
      metadata: { amount: input.amount, status },
      tx,
    });
    return request;
  });
}

export async function listReimbursements(
  organizationId: string,
  viewer: { userId: string; canManage: boolean },
  filters: { status?: ReimbursementStatus } = {}
) {
  return prisma.reimbursementRequest.findMany({
    where: {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      // Submitters without manage see exactly their own requests.
      ...(viewer.canManage ? {} : { submittedByUserId: viewer.userId }),
    },
    orderBy: { createdAt: "desc" },
    include: {
      submittedBy: { select: { displayName: true, email: true } },
      category: { select: { id: true, name: true } },
      event: { select: { id: true, title: true } },
      committee: { select: { id: true, name: true } },
      paymentMethodConfig: { select: { id: true, method: true, label: true } },
    },
    take: 300,
  });
}

export interface TransitionReimbursementInput extends ActorInput {
  organizationId: string;
  requestId: string;
  status: ReimbursementStatus;
  reviewNotes?: string | null;
  rejectionReason?: string | null;
  paymentReference?: string | null;
  /** Required when status === "PAID" (§8) — an active, org-scoped
   * PaymentMethodConfig id. Historical PAID rows from before this feature
   * remain null/free-text-only; this is only enforced going forward. */
  paymentMethodId?: string | null;
  /** Required when status === "VOIDED" | "REVERSED". */
  correctionReason?: string | null;
  /** Required when status === "VOIDED" | "REVERSED" — must equal
   * CONFIRM_TEXT[status] exactly ("VOID" / "REVERSE"). */
  confirmText?: string | null;
}

type ExistingRequest = NonNullable<Awaited<ReturnType<typeof prisma.reimbursementRequest.findFirst>>>;

export async function transitionReimbursement(input: TransitionReimbursementInput) {
  const existing = await prisma.reimbursementRequest.findFirst({
    where: { id: input.requestId, organizationId: input.organizationId },
  });
  if (!existing) throw new FinanceError("Reimbursement request not found.", 404);

  // Friendly, fast-path check against the row as last observed. This is
  // NOT the authoritative concurrency gate for PAID/VOIDED/REVERSED — see
  // markPaid()/correctPaidReimbursement()'s conditional updateMany for that
  // — it only produces a clearer error on the common, non-racing case.
  if (!ALLOWED_TRANSITIONS[existing.status].includes(input.status)) {
    throw new FinanceError(`A ${humanize(existing.status)} request cannot move to ${humanize(input.status)}.`, 409);
  }

  if (SELF_ACTOR_RESTRICTED.has(input.status) && existing.submittedByUserId === input.actorUserId) {
    throw new FinanceError(SELF_ACTOR_MESSAGES[input.status] ?? "You cannot perform this action on your own reimbursement request.", 403);
  }
  if (input.status === "REJECTED" && !input.rejectionReason?.trim()) {
    throw new FinanceError("A reason is required to reject a request.");
  }

  const now = new Date();

  if (input.status === "PAID") {
    return markPaid(input, existing, now);
  }
  if (input.status === "VOIDED" || input.status === "REVERSED") {
    return correctPaidReimbursement(input, existing, now);
  }

  // Ordinary review-stage transitions (SUBMITTED/UNDER_REVIEW/APPROVED/
  // REJECTED) never touch the expenditure ledger, so a plain conditional
  // update is sufficient — only PAID/VOIDED/REVERSED need the CAS pattern.
  return prisma.$transaction(async (tx) => {
    const updated = await tx.reimbursementRequest.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        ...(input.reviewNotes !== undefined ? { reviewNotes: input.reviewNotes?.trim() || null } : {}),
        ...(input.status === "APPROVED" ? { approvedByUserId: input.actorUserId, approvedAt: now } : {}),
        ...(input.status === "REJECTED"
          ? { rejectedByUserId: input.actorUserId, rejectedAt: now, rejectionReason: input.rejectionReason!.trim() }
          : {}),
      },
    });
    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail ?? null,
      action:
        input.status === "APPROVED" ? "reimbursement.approved" : input.status === "REJECTED" ? "reimbursement.rejected" : "reimbursement.status_changed",
      entityType: "reimbursement_request",
      entityId: existing.id,
      metadata: { before: existing.status, after: input.status },
      tx,
    });
    return updated;
  });
}

/** APPROVED → PAID. Books the linked Expenditure and requires a structured
 * payment method (§8). See the module doc comment for the CAS design. */
async function markPaid(input: TransitionReimbursementInput, existing: ExistingRequest, now: Date) {
  if (!input.paymentMethodId) {
    throw new FinanceError("Select how this reimbursement was paid.");
  }
  const method = await prisma.paymentMethodConfig.findFirst({
    where: { id: input.paymentMethodId, organizationId: input.organizationId, isActive: true },
  });
  if (!method) throw new FinanceError("Select a valid, active payment method for this organization.", 400);

  try {
    return await prisma.$transaction(async (tx) => {
      // Atomic claim: matches (and only one concurrent caller can ever
      // match) a row that is still APPROVED at the moment this UPDATE
      // actually runs, not at the moment we read it above. A losing
      // concurrent request sees count 0 and never reaches the Expenditure
      // create below — no orphaned Expenditure, no double posting.
      const claim = await tx.reimbursementRequest.updateMany({
        where: { id: existing.id, organizationId: input.organizationId, status: "APPROVED" },
        data: {
          status: "PAID",
          paidByUserId: input.actorUserId,
          paidAt: now,
          paymentReference: input.paymentReference?.trim() || null,
          paymentMethodId: method.id,
          ...(input.reviewNotes !== undefined ? { reviewNotes: input.reviewNotes?.trim() || null } : {}),
        },
      });
      if (claim.count === 0) throw new ClaimLostError();

      const expenditure = await tx.expenditure.create({
        data: {
          organizationId: input.organizationId,
          description: `Reimbursement: ${existing.description}`,
          amount: existing.amount,
          categoryId: existing.categoryId,
          date: now,
          vendor: existing.payeeName,
          eventId: existing.eventId,
          paymentMethodId: method.id,
          reference: input.paymentReference?.trim() || `REIMB-${existing.id.slice(-8)}`,
          notes: "Booked automatically when the reimbursement request was marked paid.",
        },
      });
      const updated = await tx.reimbursementRequest.update({
        where: { id: existing.id },
        data: { expenditureId: expenditure.id },
      });

      // Same `tx` as the writes above: if this insert fails, the whole
      // transaction — the PAID status flip and the Expenditure — rolls
      // back with it. No post-commit best-effort audit for money state.
      await createAuditEvent({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail ?? null,
        action: "reimbursement.paid",
        entityType: "reimbursement_request",
        entityId: existing.id,
        metadata: { amount: Number(existing.amount), expenditureId: expenditure.id, paymentMethodId: method.id },
        tx,
      });
      return updated;
    });
  } catch (error) {
    if (error instanceof ClaimLostError) {
      const current = await prisma.reimbursementRequest.findFirst({ where: { id: existing.id, organizationId: input.organizationId } });
      throw new FinanceError(
        current?.status === "PAID"
          ? "This reimbursement has already been marked paid."
          : `Cannot mark paid — this request is now ${humanize(current?.status ?? existing.status)}.`,
        409
      );
    }
    throw error;
  }
}

/** PAID → VOIDED | REVERSED. Void: marked paid in Unestra by mistake, no
 * external payment ever happened. Reversal: a real external payment was
 * later cancelled/returned/recovered outside Unestra. Either way, the
 * original ReimbursementRequest and Expenditure rows are never deleted or
 * mutated beyond these correction fields — the compensating action is
 * voiding the linked Expenditure (the same mechanism the rest of the app
 * already uses for Expenditure corrections), which `getBudgetWithActuals`/
 * `getFinanceSummary` already exclude via `voidedAt: null`. */
async function correctPaidReimbursement(input: TransitionReimbursementInput, existing: ExistingRequest, now: Date) {
  const status = input.status as "VOIDED" | "REVERSED";
  const reason = input.correctionReason?.trim();
  if (!reason) throw new FinanceError("A reason is required to void or reverse a paid reimbursement.");
  const expectedConfirm = CONFIRM_TEXT[status]!;
  if (input.confirmText !== expectedConfirm) {
    throw new FinanceError(`Type ${expectedConfirm} to confirm this ${status === "VOIDED" ? "void" : "reversal"}.`);
  }
  if (!existing.expenditureId) {
    // Unreachable in practice given the PAID⇒expenditureId CHECK
    // constraint, but fail clearly rather than silently no-op if it is.
    throw new FinanceError("This reimbursement has no linked expenditure to correct.", 409);
  }
  const expenditureId = existing.expenditureId;

  try {
    return await prisma.$transaction(async (tx) => {
      const claim = await tx.reimbursementRequest.updateMany({
        where: { id: existing.id, organizationId: input.organizationId, status: "PAID" },
        data: {
          status,
          correctionType: status === "VOIDED" ? "VOID" : "REVERSAL",
          correctedAt: now,
          correctedByUserId: input.actorUserId,
          correctionReason: reason,
        },
      });
      if (claim.count === 0) throw new ClaimLostError();

      await tx.expenditure.update({
        where: { id: expenditureId },
        data: {
          voidedAt: now,
          voidedByUserId: input.actorUserId,
          voidReason: `Reimbursement ${status === "VOIDED" ? "voided" : "reversed"}: ${reason}`,
        },
      });

      const updated = await tx.reimbursementRequest.findFirst({ where: { id: existing.id } });

      await createAuditEvent({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail ?? null,
        action: status === "VOIDED" ? "reimbursement.voided" : "reimbursement.reversed",
        entityType: "reimbursement_request",
        entityId: existing.id,
        metadata: { amount: Number(existing.amount), expenditureId, reason },
        tx,
      });
      return updated!;
    });
  } catch (error) {
    if (error instanceof ClaimLostError) {
      const current = await prisma.reimbursementRequest.findFirst({ where: { id: existing.id, organizationId: input.organizationId } });
      const verb = status === "VOIDED" ? "void" : "reverse";
      throw new FinanceError(
        current?.status === status ? `This reimbursement has already been ${humanize(status)}.` : `Cannot ${verb} — this request is now ${humanize(current?.status ?? existing.status)}.`,
        409
      );
    }
    throw error;
  }
}

/** Treasurer-dashboard summary: income vs spend in the fiscal window plus
 * the reimbursement pipeline state. Voided/reversed reimbursements' linked
 * Expenditure is voided too, so `voidedAt: null` already excludes them —
 * no separate accounting needed here. */
export async function getFinanceSummary(organizationId: string, window: { start: Date; end: Date } | null) {
  const dateFilter = window ? { gte: window.start, lt: window.end } : undefined;
  const [contributionSum, expenditureSum, pending, approvedUnpaid] = await Promise.all([
    prisma.contribution.aggregate({
      where: { organizationId, voidedAt: null, ...(dateFilter ? { contributionDate: dateFilter } : {}) },
      _sum: { amount: true },
    }),
    prisma.expenditure.aggregate({
      where: { organizationId, voidedAt: null, ...(dateFilter ? { date: dateFilter } : {}) },
      _sum: { amount: true },
    }),
    prisma.reimbursementRequest.aggregate({
      where: { organizationId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.reimbursementRequest.aggregate({
      where: { organizationId, status: "APPROVED" },
      _sum: { amount: true },
      _count: true,
    }),
  ]);
  return {
    contributionsTotal: Number(contributionSum._sum.amount ?? 0),
    expendituresTotal: Number(expenditureSum._sum.amount ?? 0),
    pendingReimbursements: { count: pending._count, total: Number(pending._sum.amount ?? 0) },
    approvedUnpaidReimbursements: { count: approvedUnpaid._count, total: Number(approvedUnpaid._sum.amount ?? 0) },
  };
}
