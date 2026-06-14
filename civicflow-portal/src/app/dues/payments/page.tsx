import { requirePermission } from "@/lib/auth-guards";
import { ensureDefaultPaymentMethods, paymentMethodLabels as defaultPaymentMethodLabels } from "@/lib/payment-methods";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { DuesPaymentsManager } from "@/components/forms/DuesPaymentsManager";

export default async function DuesPaymentsPage() {
  const { organizationId } = await requirePermission("dues:read");

  await ensureDefaultPaymentMethods(prisma, organizationId);

  const [members, charges, payments, paymentMethods] = await Promise.all([
    prisma.orgMember.findMany({
      where: { organizationId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, preferredName: true },
      take: 200,
    }),
    prisma.duesCharge.findMany({
      where: {
        organizationId,
        status: { in: ["PENDING", "PARTIAL"] },
      },
      orderBy: [{ dueDate: "asc" }],
      include: {
        duesAccount: true,
      },
      take: 200,
    }),
    prisma.duesPayment.findMany({
      where: { organizationId },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      include: {
        member: true,
        duesCharge: true,
        duesAccount: true,
      },
      take: 150,
    }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { method: true, label: true, instructions: true },
    }),
  ]);

  const methodLabels = Object.fromEntries(defaultPaymentMethodLabels);
  for (const method of paymentMethods) {
    methodLabels[method.method] = method.label;
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title="Dues Payments"
        description="Record dues payments, capture method and reference details, and automatically update any linked charge balance."
        actions={[
          { href: "/dues/charges", label: "Dues Charges" },
          { href: "/dues/payments/new", label: "Record Payment", tone: "primary" },
          { href: "/dues", label: "Back to Dues" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Open Charges" value={charges.length} />
        <StatCard label="Members" value={members.length} />
        <StatCard label="Recorded Payments" value={payments.length} />
      </div>

      <SectionCard title="Record Payment" description="Choose a member first, then optionally apply the payment to one of that member’s open charges.">
        <DuesPaymentsManager
          members={members}
          charges={charges.map((charge) => ({
            id: charge.id,
            memberId: charge.memberId,
            dueDate: charge.dueDate.toISOString(),
            status: charge.status,
            amountDue: charge.amountDue.toString(),
            amountPaid: charge.amountPaid.toString(),
            accountName: charge.duesAccount.name,
          }))}
          payments={payments.map((payment) => ({
            ...payment,
            paymentDate: payment.paymentDate.toISOString(),
            amount: payment.amount.toString(),
            duesCharge: payment.duesCharge
              ? {
                  id: payment.duesCharge.id,
                  dueDate: payment.duesCharge.dueDate.toISOString(),
                  status: payment.duesCharge.status,
                }
              : null,
            duesAccount: payment.duesAccount
              ? {
                  id: payment.duesAccount.id,
                  name: payment.duesAccount.name,
                }
              : null,
          }))}
          paymentMethods={paymentMethods}
          paymentMethodLabels={methodLabels}
        />
      </SectionCard>
    </main>
  );
}
