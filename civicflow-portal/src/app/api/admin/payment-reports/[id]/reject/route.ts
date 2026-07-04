import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { sendPushToMember } from "@/lib/push";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const bodySchema = z.object({
  rejectionReason: z.string().trim().min(1).max(2000),
});

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
    const { rejectionReason } = await parseJsonBody(request, bodySchema);

    const report = await prisma.paymentReport.findFirst({ where: { id, organizationId }, include: { member: true } });
    if (!report) {
      return Response.json({ ok: false, error: "Payment report not found" }, { status: 404 });
    }
    if (report.status !== "pending") {
      throw new ValidationError("This payment report has already been reviewed.");
    }

    const updated = await prisma.paymentReport.update({
      where: { id: report.id },
      data: {
        status: "rejected",
        reviewedById: session.userId,
        reviewedAt: new Date(),
        rejectionReason,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
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

    return Response.json({ ok: true, data: updated });
  });
}
