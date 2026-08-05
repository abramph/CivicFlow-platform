import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const bodySchema = z.object({
  note: z.union([z.string().trim().max(2000), z.literal(""), z.null()]).optional(),
});

/**
 * Approves a public payer's self-reported offline payment against a Payment
 * Link, creating a Contribution -- always Contribution, never a DuesPayment,
 * since an anonymous payer has no member/dues context to apply against (see
 * docs/flexible-payment-links.md). The compare-and-swap claim happens INSIDE
 * the same transaction as the Contribution creation (rather than claim-then-
 * create, or create-then-claim) so a lost race against a concurrent
 * approve/reject rolls back the Contribution too -- no orphaned financial
 * record can survive a lost race.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:payment-link-reports:review",
      request,
      limit: 60,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("payment_link_reports:review", "throw");
    const { id } = await params;
    const { note } = await parseJsonBody(request, bodySchema);

    const report = await prisma.paymentLinkOfflineReport.findFirst({
      where: { id, organizationId },
      include: { paymentMethodConfig: { select: { method: true } }, paymentLink: { select: { title: true } } },
    });
    if (!report) {
      return Response.json({ ok: false, error: "Payment report not found" }, { status: 404 });
    }
    if (report.status !== "pending") {
      throw new ValidationError("This payment report has already been reviewed.");
    }

    const contribution = await prisma.$transaction(async (tx) => {
      const { count } = await tx.paymentLinkOfflineReport.updateMany({
        where: { id: report.id, organizationId, status: "pending" },
        data: { status: "approved", reviewedById: session.userId, reviewedAt: new Date() },
      });
      if (count === 0) {
        // Lost a race against a concurrent approve/reject -- rolling back
        // this transaction means no Contribution is ever created for the loser.
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
          createdByUserId: session.userId,
        },
      });

      await tx.paymentLinkOfflineReport.update({
        where: { id: report.id },
        data: { resultingContributionId: created.id },
      });

      return created;
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
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
    return Response.json({ ok: true, data: updated });
  });
}
