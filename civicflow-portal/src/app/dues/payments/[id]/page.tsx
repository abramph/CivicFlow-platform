import { requirePermission } from "@/lib/auth-guards";
import { paymentMethodLabels } from "@/lib/payment-methods";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import {
  formatCurrency,
  formatDate,
  formatEnumLabel,
  formatPersonName,
  formatText,
} from "@/lib/formatting";

export default async function DuesPaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organizationId } = await requirePermission("dues:read");
  const { id } = await params;

  const payment = await prisma.duesPayment.findFirst({
    where: { id, organizationId },
    include: {
      member: true,
      duesAccount: true,
      duesCharge: {
        include: {
          duesAccount: true,
        },
      },
    },
  });
  const methodConfig = payment
    ? await prisma.paymentMethodConfig.findFirst({
        where: { organizationId, method: payment.method },
        select: { label: true },
      })
    : null;

  if (!payment) {
    return (
      <main className="space-y-6">
        <PageHeader
          title="Dues payment not found"
          description="The requested dues payment does not exist in your organization."
          actions={[
            { href: "/dues/payments", label: "Back to Dues Payments" },
            { href: "/dashboard", label: "Back to Dashboard" },
          ]}
        />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title="Dues Payment Detail"
        description="Payment detail showing member attribution, payment method, and any linked dues charge."
        actions={[
          { href: `/members/${payment.member.id}`, label: "View Member" },
          { href: "/dues/payments", label: "Back to Dues Payments" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Member" value={formatPersonName(payment.member)} />
        <StatCard label="Payment Date" value={formatDate(payment.paymentDate)} />
        <StatCard label="Method" value={methodConfig?.label ?? paymentMethodLabels.get(payment.method) ?? formatEnumLabel(payment.method)} />
        <StatCard label="Amount" value={formatCurrency(payment.amount)} />
      </div>

      <SectionCard title="Payment Overview" description="Payment records are scoped to the organization session and optionally linked to a specific charge.">
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard label="Reference" value={formatText(payment.reference, "No reference provided")} />
          <StatCard label="Linked Charge" value={payment.duesCharge ? payment.duesCharge.id : "Unapplied"} />
          <StatCard
            label="Dues Account"
            value={payment.duesAccount?.name ?? payment.duesCharge?.duesAccount.name ?? "No linked account"}
          />
          {payment.duesCharge ? (
            <>
              <StatCard label="Charge Status" value={formatEnumLabel(payment.duesCharge.status)} />
              <StatCard label="Charge Due Date" value={formatDate(payment.duesCharge.dueDate)} />
              <StatCard label="Charge Balance" value={formatCurrency(Number(payment.duesCharge.amountDue) - Number(payment.duesCharge.amountPaid))} />
            </>
          ) : null}
        </div>
        {payment.notes ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-950">Notes</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{payment.notes}</p>
          </div>
        ) : null}
      </SectionCard>
    </main>
  );
}
