import { Prisma, type ReimbursementStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { FinanceError } from "@/lib/finance-errors";

/**
 * PTA Vertical 2.0, PR PTA-H — the reimbursement workflow (core;
 * docs/pta-vertical-2.md PTA-H).
 *
 * SUBMITTED → UNDER_REVIEW → APPROVED → PAID; REJECTED from any pre-PAID
 * state. PAID and REJECTED are terminal (a resubmission is a new request).
 *
 * Two rules no permission bypasses:
 *  - the approver must differ from the submitter (self-approval forbidden —
 *    same reasoning as volunteer-hours approvals);
 *  - PAID transactionally books a real Expenditure row and links it, so a
 *    paid reimbursement hits budget actuals and the expenditure ledger with
 *    no second data entry (and no chance of forgetting it).
 *
 * No bank credentials, account numbers, or payment rails — recording an
 * external payment is all "paying" means here.
 */

interface ActorInput {
  actorUserId: string;
  actorEmail?: string | null;
}

const ALLOWED_TRANSITIONS: Record<ReimbursementStatus, ReimbursementStatus[]> = {
  SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "SUBMITTED"],
  APPROVED: ["PAID", "REJECTED", "UNDER_REVIEW"],
  PAID: [],
  REJECTED: [],
};

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

  const request = await prisma.reimbursementRequest.create({
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
  });
  return request;
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
}

export async function transitionReimbursement(input: TransitionReimbursementInput) {
  const existing = await prisma.reimbursementRequest.findFirst({
    where: { id: input.requestId, organizationId: input.organizationId },
  });
  if (!existing) throw new FinanceError("Reimbursement request not found.", 404);

  if (!ALLOWED_TRANSITIONS[existing.status].includes(input.status)) {
    throw new FinanceError(`A ${existing.status.toLowerCase().replaceAll("_", " ")} request cannot move to ${input.status.toLowerCase().replaceAll("_", " ")}.`, 409);
  }

  if (input.status === "APPROVED" && existing.submittedByUserId === input.actorUserId) {
    throw new FinanceError("You cannot approve your own reimbursement request.", 403);
  }
  if (input.status === "REJECTED" && !input.rejectionReason?.trim()) {
    throw new FinanceError("A reason is required to reject a request.");
  }

  const now = new Date();

  if (input.status === "PAID") {
    // Book the expense and link it, atomically.
    const [request] = await prisma.$transaction(async (tx) => {
      const expenditure = await tx.expenditure.create({
        data: {
          organizationId: input.organizationId,
          description: `Reimbursement: ${existing.description}`,
          amount: existing.amount,
          categoryId: existing.categoryId,
          date: now,
          vendor: existing.payeeName,
          eventId: existing.eventId,
          reference: input.paymentReference?.trim() || `REIMB-${existing.id.slice(-8)}`,
          notes: "Booked automatically when the reimbursement request was marked paid.",
        },
      });
      const updated = await tx.reimbursementRequest.update({
        where: { id: existing.id },
        data: {
          status: "PAID",
          paidByUserId: input.actorUserId,
          paidAt: now,
          paymentReference: input.paymentReference?.trim() || null,
          expenditureId: expenditure.id,
          ...(input.reviewNotes !== undefined ? { reviewNotes: input.reviewNotes?.trim() || null } : {}),
        },
      });
      return [updated, expenditure];
    });

    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail ?? null,
      action: "reimbursement.paid",
      entityType: "reimbursement_request",
      entityId: existing.id,
      metadata: { amount: Number(existing.amount), expenditureId: request.expenditureId },
    });
    return request;
  }

  const request = await prisma.reimbursementRequest.update({
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
  });
  return request;
}

/** Treasurer-dashboard summary: income vs spend in the fiscal window plus
 * the reimbursement pipeline state. */
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
