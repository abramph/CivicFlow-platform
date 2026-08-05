import { createAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";

/**
 * Creates a pending PaymentLinkOfflineReport (a public payer's self-reported
 * offline payment against a Payment Link) and emails the org's treasurers/
 * admins to review it. Mirrors createPaymentReportAndNotify's shape
 * (src/lib/payment-reports.ts) for the anonymous-payer case -- see
 * docs/flexible-payment-links.md.
 */
export async function createPaymentLinkOfflineReportAndNotify(params: {
  organizationId: string;
  paymentLinkId: string;
  paymentMethodConfigId: string;
  payerName: string;
  payerEmail: string;
  amount: number;
  referenceNumber?: string | null;
  message?: string | null;
  proofAttachmentId?: string | null;
}) {
  const report = await prisma.paymentLinkOfflineReport.create({
    data: {
      organizationId: params.organizationId,
      paymentLinkId: params.paymentLinkId,
      paymentMethodConfigId: params.paymentMethodConfigId,
      payerName: params.payerName,
      payerEmail: params.payerEmail,
      amount: params.amount,
      referenceNumber: params.referenceNumber ?? null,
      message: params.message ?? null,
      proofAttachmentId: params.proofAttachmentId ?? null,
    },
  });

  await createAuditEvent({
    organizationId: params.organizationId,
    action: "payment_link_offline_report.create",
    entityType: "payment_link_offline_report",
    entityId: report.id,
    metadata: { amount: report.amount.toString(), paymentLinkId: params.paymentLinkId },
  });

  const [link, treasurers] = await Promise.all([
    prisma.paymentLink.findFirst({ where: { id: params.paymentLinkId }, select: { title: true } }),
    prisma.organizationMembership.findMany({
      where: { organizationId: params.organizationId, role: { in: ["FINANCE", "ORG_ADMIN", "ORG_OWNER"] } },
      include: { user: { select: { email: true } } },
    }),
  ]);

  await Promise.all(
    treasurers.map((membership) =>
      sendEmail({
        to: membership.user.email,
        subject: "New payment link report to review",
        text: [
          `${params.payerName} reported a payment of $${params.amount.toFixed(2)}`,
          `for "${link?.title ?? "a payment link"}".`,
          "Review it in the Unestra portal under Payment Links.",
        ].join(" "),
      }).catch(() => null)
    )
  );

  return report;
}
