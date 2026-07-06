import type { DuesPaymentMethod, PaymentReportCategory } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";

export const DUES_PAYMENT_METHODS = [
  "CASH", "CHECK", "CREDIT_CARD", "DEBIT_CARD", "CARD", "ACH",
  "ZELLE", "CASH_APP", "VENMO", "PAYPAL", "STRIPE", "ZEFFY", "OTHER",
] as const satisfies readonly DuesPaymentMethod[];

/**
 * Creates a pending PaymentReport and emails the org's treasurers/admins to
 * review it. Shared by the mobile app's report-payment route and the web
 * fallback's — the only difference between those two entry points is how
 * the receipt gets attached (multipart upload vs. none), not this part.
 */
export async function createPaymentReportAndNotify(params: {
  organizationId: string;
  memberId: string;
  amount: number;
  paymentMethod: (typeof DUES_PAYMENT_METHODS)[number];
  paymentDate: Date;
  referenceNumber?: string | null;
  note?: string | null;
  /** Defaults to MEMBERSHIP_DUES so every existing caller (and every row
   * created before this field existed) keeps behaving exactly as before. */
  category?: PaymentReportCategory;
  /** Only meaningful when category is MEMBERSHIP_DUES — which outstanding
   * charge the member says this applies to. Not validated against the
   * member's actual charges here; the approver isn't bound to it either. */
  duesChargeId?: string | null;
}) {
  const category = params.category ?? "MEMBERSHIP_DUES";
  const report = await prisma.paymentReport.create({
    data: {
      organizationId: params.organizationId,
      memberId: params.memberId,
      amount: params.amount,
      paymentMethod: params.paymentMethod,
      paymentDate: params.paymentDate,
      referenceNumber: params.referenceNumber ?? null,
      note: params.note ?? null,
      category,
      duesChargeId: category === "MEMBERSHIP_DUES" ? (params.duesChargeId ?? null) : null,
    },
  });

  await createAuditEvent({
    organizationId: params.organizationId,
    action: "payment_report.create",
    entityType: "payment_report",
    entityId: report.id,
    metadata: { amount: report.amount.toString(), paymentMethod: report.paymentMethod, category },
  });

  const [member, treasurers] = await Promise.all([
    prisma.orgMember.findFirst({ where: { id: params.memberId }, select: { firstName: true, lastName: true } }),
    prisma.organizationMembership.findMany({
      where: { organizationId: params.organizationId, role: { in: ["FINANCE", "ORG_ADMIN", "ORG_OWNER"] } },
      include: { user: { select: { email: true } } },
    }),
  ]);

  await Promise.all(
    treasurers.map((membership) =>
      sendEmail({
        to: membership.user.email,
        subject: "New member payment report to review",
        text: [
          `${member?.firstName ?? ""} ${member?.lastName ?? ""}`.trim() || "A member",
          `reported a ${category.replace(/_/g, " ").toLowerCase()} payment of $${params.amount.toFixed(2)} via ${params.paymentMethod}.`,
          "Review it in the CivicFlow portal under Payment Reports.",
        ].join(" "),
      }).catch(() => null)
    )
  );

  return report;
}
