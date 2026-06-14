import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { paymentMethodLabels as defaultPaymentMethodLabels } from "@/lib/payment-methods";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { DuesAdjustmentForm } from "@/components/forms/DuesAdjustmentForm";
import {
  formatCurrency,
  formatDate,
  formatEnumLabel,
  formatPersonName,
  formatText,
} from "@/lib/formatting";

export default async function DuesChargeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organizationId } = await requirePermission("dues:read");
  const { id } = await params;

  const charge = await prisma.duesCharge.findFirst({
    where: { id, organizationId },
    include: {
      member: true,
      duesAccount: {
        include: {
          category: true,
        },
      },
      payments: {
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      },
      adjustments: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!charge) {
    return (
      <main className="space-y-6">
        <PageHeader
          title="Dues charge not found"
          description="The requested dues charge does not exist in your organization."
          actions={[
            { href: "/dues/charges", label: "Back to Dues Charges" },
            { href: "/dashboard", label: "Back to Dashboard" },
          ]}
        />
      </main>
    );
  }

  const paymentMethods = await prisma.paymentMethodConfig.findMany({
    where: { organizationId },
    select: { method: true, label: true },
  });
  const methodLabels = Object.fromEntries(defaultPaymentMethodLabels);
  for (const method of paymentMethods) {
    methodLabels[method.method] = method.label;
  }
  const adjustmentTotal = charge.adjustments.reduce((sum, adjustment) => sum + Number(adjustment.amount), 0);
  const balance = Math.max(0, Number(charge.amountDue) - Number(charge.amountPaid) - adjustmentTotal);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Dues Charge Detail"
        description="Charge detail showing member attribution, source account, and all payments applied to the charge."
        actions={[
          ...(charge.status === "PAID"
            ? []
            : [{ href: `/dues/payments/new?chargeId=${charge.id}`, label: "Pay This Charge", tone: "primary" as const }]),
          { href: `/members/${charge.member.id}`, label: "View Member" },
          { href: "/dues/charges", label: "Back to Dues Charges" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Member" value={formatPersonName(charge.member)} />
        <StatCard label="Status" value={formatEnumLabel(charge.status)} />
        <StatCard label="Amount Due" value={formatCurrency(charge.amountDue)} />
        <StatCard label="Amount Paid" value={formatCurrency(charge.amountPaid)} />
        <StatCard label="Adjustments" value={formatCurrency(adjustmentTotal)} />
        <StatCard label="Balance" value={formatCurrency(balance)} />
      </div>

      <SectionCard title="Charge Overview" description="The charge stays linked to both the member and the originating dues account.">
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard label="Due Date" value={formatDate(charge.dueDate)} />
          <StatCard label="Dues Account" value={charge.duesAccount.name} />
          <StatCard
            label="Dues Category"
            value={formatText(charge.duesAccount.category?.name, "No linked category")}
          />
          <StatCard label="Account Frequency" value={formatEnumLabel(charge.duesAccount.frequency)} />
        </div>
        {charge.notes ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-950">Notes</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{charge.notes}</p>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Adjustments" description="Adjustments reduce the outstanding balance while preserving the original charge amount.">
        <DuesAdjustmentForm memberId={charge.member.id} duesChargeId={charge.id} />
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {charge.adjustments.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-600">No adjustments recorded for this charge.</td></tr>
              ) : charge.adjustments.map((adjustment) => (
                <tr key={adjustment.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-900">{formatDate(adjustment.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(adjustment.adjustmentType)}</td>
                  <td className="px-4 py-3 text-slate-900">{adjustment.reason}</td>
                  <td className="px-4 py-3 text-slate-900">{formatCurrency(adjustment.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Applied Payments" description="Payments linked to this charge automatically update the charge balance and status.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Payment date</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {charge.payments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-600">
                    No payments have been applied to this charge yet.
                  </td>
                </tr>
              ) : (
                charge.payments.map((payment) => (
                  <tr key={payment.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">
                      <Link href={`/dues/payments/${payment.id}`} className="text-emerald-700 hover:underline">
                        {formatDate(payment.paymentDate)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-900">{methodLabels[payment.method] ?? formatEnumLabel(payment.method)}</td>
                    <td className="px-4 py-3 text-slate-900">{payment.reference || "—"}</td>
                    <td className="px-4 py-3 text-slate-900">{formatCurrency(payment.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
