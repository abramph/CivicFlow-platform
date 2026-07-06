import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { recordDuesPayment } from "@/lib/dues-payments";
import { sendEmail } from "@/lib/mail";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { PAYMENT_REPORT_CATEGORY_LABELS } from "@/lib/payment-report-categories";
import { prisma } from "@/lib/prisma";
import { sendPushToMember } from "@/lib/push";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const bodySchema = z.object({
  note: z.union([z.string().trim().max(2000), z.literal(""), z.null()]).optional(),
});

/**
 * Approves a member-submitted payment report. MEMBERSHIP_DUES reports apply
 * to the member's oldest outstanding dues charge (if any) and record a
 * DuesPayment — unchanged behavior from before categories existed. Every
 * other category records a Contribution instead (reusing the existing
 * donation/fundraiser ledger), and never touches dues charges.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:payment-reports:review",
      request,
      limit: 60,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("dues:write", "throw");
    const { id } = await params;
    const { note } = await parseJsonBody(request, bodySchema);

    const report = await prisma.paymentReport.findFirst({
      where: { id, organizationId },
      include: { member: true },
    });
    if (!report) {
      return Response.json({ ok: false, error: "Payment report not found" }, { status: 404 });
    }
    if (report.status !== "pending") {
      throw new ValidationError("This payment report has already been reviewed.");
    }

    const categoryLabel = PAYMENT_REPORT_CATEGORY_LABELS[report.category];
    let auditMetadata: Record<string, string> = { category: report.category };

    if (report.category === "MEMBERSHIP_DUES") {
      const charge = await prisma.duesCharge.findFirst({
        where: { organizationId, memberId: report.memberId, status: { in: ["PENDING", "PARTIAL"] } },
        orderBy: [{ dueDate: "asc" }],
      });

      const payment = await recordDuesPayment({
        organizationId,
        memberId: report.memberId,
        duesChargeId: charge?.id ?? null,
        amount: Number(report.amount),
        paymentDate: report.paymentDate,
        method: report.paymentMethod,
        reference: report.referenceNumber,
        notes: note ? `${note} (approved from member-reported payment)` : "Approved from member-reported payment",
        charge,
      });

      await createMemberTimelineEvent({
        organizationId,
        memberId: report.memberId,
        eventType: "PAYMENT_RECORDED",
        title: "Member-reported payment approved",
        newValue: { paymentReportId: report.id, duesPaymentId: payment.id, amount: payment.amount.toString() },
        createdByUserId: session.userId,
      });

      auditMetadata = { ...auditMetadata, duesPaymentId: payment.id, amount: payment.amount.toString() };
    } else {
      const contribution = await prisma.contribution.create({
        data: {
          organizationId,
          memberId: report.memberId,
          amount: report.amount,
          contributionDate: report.paymentDate,
          paymentMethod: report.paymentMethod,
          source: "MANUAL",
          notes: [
            `Approved from member-reported ${categoryLabel.toLowerCase()} payment report.`,
            note || null,
          ].filter(Boolean).join(" "),
          createdByUserId: session.userId,
        },
      });

      await createMemberTimelineEvent({
        organizationId,
        memberId: report.memberId,
        eventType: "CONTRIBUTION_RECORDED",
        title: `Member-reported ${categoryLabel.toLowerCase()} approved`,
        newValue: { paymentReportId: report.id, contributionId: contribution.id, amount: contribution.amount.toString() },
        createdByUserId: session.userId,
      });

      auditMetadata = { ...auditMetadata, contributionId: contribution.id, amount: contribution.amount.toString() };
    }

    const updated = await prisma.paymentReport.update({
      where: { id: report.id },
      data: {
        status: "approved",
        reviewedById: session.userId,
        reviewedAt: new Date(),
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
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

    return Response.json({ ok: true, data: updated });
  });
}
