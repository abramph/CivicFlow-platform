import type { PaymentLinkOfflineReport } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/mail";
import { ValidationError } from "@/lib/validation";

/**
 * Shared PaymentLinkOfflineReport (anonymous public-payer self-report)
 * approve/reject logic — used by the web /api/admin/payment-link-reports
 * routes and the mobile admin equivalents. Approval always creates a
 * Contribution (never a DuesPayment, since an anonymous payer has no
 * member/dues context) inside the same compare-and-swap transaction as the
 * status claim, so a lost race never leaves an orphaned Contribution.
 */

export interface PaymentLinkReportReviewActor {
  userId: string;
  userEmail?: string | null;
}

export type PaymentLinkReportMutationResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function approvePaymentLinkOfflineReport(
  organizationId: string,
  actor: PaymentLinkReportReviewActor,
  reportId: string,
  note?: string | null
): Promise<PaymentLinkReportMutationResult<PaymentLinkOfflineReport>> {
  const report = await prisma.paymentLinkOfflineReport.findFirst({
    where: { id: reportId, organizationId },
    include: { paymentMethodConfig: { select: { method: true } }, paymentLink: { select: { title: true } } },
  });
  if (!report) return { ok: false, status: 404, error: "Payment report not found" };
  if (report.status !== "pending") return { ok: false, status: 400, error: "This payment report has already been reviewed." };

  const contribution = await prisma.$transaction(async (tx) => {
    const { count } = await tx.paymentLinkOfflineReport.updateMany({
      where: { id: report.id, organizationId, status: "pending" },
      data: { status: "approved", reviewedById: actor.userId, reviewedAt: new Date() },
    });
    if (count === 0) {
      throw new ValidationError("This payment report was just reviewed by someone else. Refresh and try again.");
    }

    const created = await tx.contribution.create({
      data: {
        organizationId,
        amount: report.amount,
        contributionDate: new Date(),
        paymentMethod: report.paymentMethodConfig.method,
        source: "MANUAL",
        contributorName: report.payerName,
        notes: [
          `Approved from a public payment-link report ("${report.paymentLink.title}").`,
          report.referenceNumber ? `Reference: ${report.referenceNumber}.` : null,
          note || null,
        ]
          .filter(Boolean)
          .join(" "),
        createdByUserId: actor.userId,
      },
    });

    await tx.paymentLinkOfflineReport.update({ where: { id: report.id }, data: { resultingContributionId: created.id } });

    return created;
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "payment_link_offline_report.approve",
    entityType: "payment_link_offline_report",
    entityId: report.id,
    metadata: { contributionId: contribution.id, amount: contribution.amount.toString() },
  });

  await sendEmail({
    to: report.payerEmail,
    subject: "Your payment has been confirmed",
    text: `Your reported payment of $${Number(report.amount).toFixed(2)} for "${report.paymentLink.title}" has been reviewed and approved. Thank you!`,
  }).catch(() => null);

  const updated = await prisma.paymentLinkOfflineReport.findUniqueOrThrow({ where: { id: report.id } });
  return { ok: true, data: updated };
}

export async function rejectPaymentLinkOfflineReport(
  organizationId: string,
  actor: PaymentLinkReportReviewActor,
  reportId: string,
  rejectionReason: string
): Promise<PaymentLinkReportMutationResult<PaymentLinkOfflineReport>> {
  const report = await prisma.paymentLinkOfflineReport.findFirst({ where: { id: reportId, organizationId } });
  if (!report) return { ok: false, status: 404, error: "Payment report not found" };
  if (report.status !== "pending") return { ok: false, status: 400, error: "This payment report has already been reviewed." };

  const { count } = await prisma.paymentLinkOfflineReport.updateMany({
    where: { id: report.id, organizationId, status: "pending" },
    data: { status: "rejected", reviewedById: actor.userId, reviewedAt: new Date(), rejectionReason },
  });
  if (count === 0) return { ok: false, status: 400, error: "This payment report was just reviewed by someone else. Refresh and try again." };

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail,
    action: "payment_link_offline_report.reject",
    entityType: "payment_link_offline_report",
    entityId: report.id,
    metadata: { rejectionReason },
  });

  await sendEmail({
    to: report.payerEmail,
    subject: "Your reported payment could not be confirmed",
    text: [
      `Your reported payment of $${Number(report.amount).toFixed(2)} could not be confirmed.`,
      `Reason: ${rejectionReason}`,
      "Please contact the organization directly, or submit the report again with corrected details.",
    ].join("\n"),
  }).catch(() => null);

  const updated = await prisma.paymentLinkOfflineReport.findUniqueOrThrow({ where: { id: report.id } });
  return { ok: true, data: updated };
}
