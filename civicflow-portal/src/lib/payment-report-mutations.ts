import type { PaymentReport } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { recordDuesPayment } from "@/lib/dues-payments";
import { sendEmail } from "@/lib/mail";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { PAYMENT_REPORT_CATEGORY_LABELS } from "@/lib/payment-report-categories";
import { sendPushToMember } from "@/lib/push";

/**
 * Shared member-submitted PaymentReport approve/reject logic — used by the
 * web /api/admin/payment-reports/[id]/{approve,reject} routes and the
 * mobile admin equivalents. Both actions use a compare-and-swap claim
 * (status: "pending" in the update's own WHERE clause) so a lost race
 * against a concurrent reviewer never creates an orphaned DuesPayment/
 * Contribution or double-notifies a member — see docs on the
 * payment-link-reports sibling flow, which established this pattern first.
 */

export interface PaymentReportReviewActor {
  userId: string;
  userEmail?: string | null;
}

export type PaymentReportMutationResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function approvePaymentReport(
  organizationId: string,
  actor: PaymentReportReviewActor,
  reportId: string,
  note?: string | null
): Promise<PaymentReportMutationResult<PaymentReport>> {
  const report = await prisma.paymentReport.findFirst({ where: { id: reportId, organizationId }, include: { member: true } });
  if (!report) return { ok: false, status: 404, error: "Payment report not found" };
  if (report.status !== "pending") return { ok: false, status: 400, error: "This payment report has already been reviewed." };

  const categoryLabel = PAYMENT_REPORT_CATEGORY_LABELS[report.category];

  let claimLost = false;
  const { payment, contribution } = await prisma.$transaction(async (tx) => {
    const { count } = await tx.paymentReport.updateMany({
      where: { id: report.id, organizationId, status: "pending" },
      data: { status: "approved", reviewedById: actor.userId, reviewedAt: new Date() },
    });
    if (count === 0) {
      claimLost = true;
      return { payment: null, contribution: null };
    }

    if (report.category === "MEMBERSHIP_DUES") {
      const charge = await tx.duesCharge.findFirst({
        where: { organizationId, memberId: report.memberId, status: { in: ["PENDING", "PARTIAL"] } },
        orderBy: [{ dueDate: "asc" }],
      });
      const createdPayment = await recordDuesPayment(
        {
          organizationId,
          memberId: report.memberId,
          duesChargeId: charge?.id ?? null,
          amount: Number(report.amount),
          paymentDate: report.paymentDate,
          method: report.paymentMethod,
          reference: report.referenceNumber,
          notes: note ? `${note} (approved from member-reported payment)` : "Approved from member-reported payment",
          charge,
        },
        tx
      );
      return { payment: createdPayment, contribution: null };
    }

    const createdContribution = await tx.contribution.create({
      data: {
        organizationId,
        memberId: report.memberId,
        amount: report.amount,
        contributionDate: report.paymentDate,
        paymentMethod: report.paymentMethod,
        source: "MANUAL",
        notes: [`Approved from member-reported ${categoryLabel.toLowerCase()} payment report.`, note || null].filter(Boolean).join(" "),
        createdByUserId: actor.userId,
      },
    });
    return { payment: null, contribution: createdContribution };
  });

  if (claimLost) {
    // Matches the existing ValidationError-style 400 this codebase already
    // uses for this exact race (see payment-link-reports' approve route) --
    // not a distinct 409, to stay consistent with the established convention.
    return { ok: false, status: 400, error: "This payment report was just reviewed by someone else. Refresh and try again." };
  }

  let auditMetadata: Record<string, string> = { category: report.category };

  if (payment) {
    await createMemberTimelineEvent({
      organizationId,
      memberId: report.memberId,
      eventType: "PAYMENT_RECORDED",
      title: "Member-reported payment approved",
      newValue: { paymentReportId: report.id, duesPaymentId: payment.id, amount: payment.amount.toString() },
      createdByUserId: actor.userId,
    });
    auditMetadata = { ...auditMetadata, duesPaymentId: payment.id, amount: payment.amount.toString() };
  } else if (contribution) {
    await createMemberTimelineEvent({
      organizationId,
      memberId: report.memberId,
      eventType: "CONTRIBUTION_RECORDED",
      title: `Member-reported ${categoryLabel.toLowerCase()} approved`,
      newValue: { paymentReportId: report.id, contributionId: contribution.id, amount: contribution.amount.toString() },
      createdByUserId: actor.userId,
    });
    auditMetadata = { ...auditMetadata, contributionId: contribution.id, amount: contribution.amount.toString() };
  }

  const updated = await prisma.paymentReport.findUniqueOrThrow({ where: { id: report.id } });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "payment_report.approve",
    entityType: "payment_report",
    entityId: report.id,
    metadata: auditMetadata,
  });

  if (report.member.email) {
    await sendEmail({
      to: report.member.email,
      subject: "Your payment has been confirmed",
      text: `Your reported ${categoryLabel.toLowerCase()} payment of $${Number(report.amount).toFixed(2)} has been reviewed and approved. Thank you!`,
    }).catch(() => null);
  }

  await sendPushToMember({
    organizationId,
    memberId: report.memberId,
    title: "Payment Confirmed",
    body: `Your ${categoryLabel.toLowerCase()} payment of $${Number(report.amount).toFixed(2)} has been approved. Thank you!`,
    deepLink: "/payment-history",
    required: true,
  }).catch(() => null);

  return { ok: true, data: updated };
}

export async function rejectPaymentReport(
  organizationId: string,
  actor: PaymentReportReviewActor,
  reportId: string,
  rejectionReason: string
): Promise<PaymentReportMutationResult<PaymentReport>> {
  const report = await prisma.paymentReport.findFirst({ where: { id: reportId, organizationId }, include: { member: true } });
  if (!report) return { ok: false, status: 404, error: "Payment report not found" };
  if (report.status !== "pending") return { ok: false, status: 400, error: "This payment report has already been reviewed." };

  const { count } = await prisma.paymentReport.updateMany({
    where: { id: report.id, organizationId, status: "pending" },
    data: { status: "rejected", reviewedById: actor.userId, reviewedAt: new Date(), rejectionReason },
  });
  if (count === 0) {
    return { ok: false, status: 400, error: "This payment report was just reviewed by someone else. Refresh and try again." };
  }

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "payment_report.reject",
    entityType: "payment_report",
    entityId: report.id,
    metadata: { rejectionReason },
  });

  if (report.member.email) {
    await sendEmail({
      to: report.member.email,
      subject: "Your reported payment could not be confirmed",
      text: [
        `Your reported payment of $${Number(report.amount).toFixed(2)} could not be confirmed.`,
        `Reason: ${rejectionReason}`,
        "Please contact your organization or report the payment again with corrected details.",
      ].join("\n"),
    }).catch(() => null);
  }

  await sendPushToMember({
    organizationId,
    memberId: report.memberId,
    title: "Payment Not Confirmed",
    body: `Your reported payment of $${Number(report.amount).toFixed(2)} could not be confirmed: ${rejectionReason}`,
    deepLink: "/report-payment",
    required: true,
  }).catch(() => null);

  const updated = await prisma.paymentReport.findUniqueOrThrow({ where: { id: report.id } });
  return { ok: true, data: updated };
}
