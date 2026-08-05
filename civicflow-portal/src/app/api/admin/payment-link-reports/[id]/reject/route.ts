import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const bodySchema = z.object({
  rejectionReason: z.string().trim().min(1).max(2000),
});

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
    const { rejectionReason } = await parseJsonBody(request, bodySchema);

    const report = await prisma.paymentLinkOfflineReport.findFirst({ where: { id, organizationId } });
    if (!report) {
      return Response.json({ ok: false, error: "Payment report not found" }, { status: 404 });
    }
    if (report.status !== "pending") {
      throw new ValidationError("This payment report has already been reviewed.");
    }

    const { count } = await prisma.paymentLinkOfflineReport.updateMany({
      where: { id: report.id, organizationId, status: "pending" },
      data: { status: "rejected", reviewedById: session.userId, reviewedAt: new Date(), rejectionReason },
    });
    if (count === 0) {
      throw new ValidationError("This payment report was just reviewed by someone else. Refresh and try again.");
    }

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
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
    return Response.json({ ok: true, data: updated });
  });
}
