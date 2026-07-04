import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { recordDuesPayment } from "@/lib/dues-payments";
import { sendEmail } from "@/lib/mail";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { prisma } from "@/lib/prisma";
import { sendPushToMember } from "@/lib/push";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const bodySchema = z.object({
  note: z.union([z.string().trim().max(2000), z.literal(""), z.null()]).optional(),
});

/**
 * Approves a member-submitted payment report: applies it to the member's
 * oldest outstanding dues charge (if any), records a DuesPayment, and
 * notifies the member.
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

    const updated = await prisma.paymentReport.update({
      where: { id: report.id },
      data: {
        status: "approved",
        reviewedById: session.userId,
        reviewedAt: new Date(),
      },
    });

    await createMemberTimelineEvent({
      organizationId,
      memberId: report.memberId,
      eventType: "PAYMENT_RECORDED",
      title: "Member-reported payment approved",
      newValue: { paymentReportId: report.id, duesPaymentId: payment.id, amount: payment.amount.toString() },
      createdByUserId: session.userId,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "payment_report.approve",
      entityType: "payment_report",
      entityId: report.id,
      metadata: { duesPaymentId: payment.id, amount: payment.amount.toString() },
    });

    if (report.member.email) {
      await sendEmail({
        to: report.member.email,
        subject: "Your payment has been confirmed",
        text: `Your reported payment of $${Number(report.amount).toFixed(2)} has been reviewed and approved. Thank you!`,
      }).catch(() => null);
    }

    await sendPushToMember({
      organizationId,
      memberId: report.memberId,
      title: "Payment Confirmed",
      body: `Your payment of $${Number(report.amount).toFixed(2)} has been approved. Thank you!`,
      deepLink: "/payment-history",
      required: true,
    }).catch(() => null);

    return Response.json({ ok: true, data: updated });
  });
}
