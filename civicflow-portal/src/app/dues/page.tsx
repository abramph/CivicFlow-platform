import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatCurrency } from "@/lib/formatting";
import { getVerticalTerminology } from "@/lib/vertical-terminology";

export default async function DuesPage() {
  const { organizationId, session } = await requirePermission("dues:read");
  const terminology = getVerticalTerminology(session.primaryVertical ?? "COMMUNITY");

  const [accountCount, chargeSummary, paymentSummary, duesCategories, membershipCategories] =
    await Promise.all([
      prisma.duesAccount.count({ where: { organizationId } }),
      prisma.duesCharge.aggregate({
        where: { organizationId },
        _sum: { amountDue: true, amountPaid: true },
        _count: { id: true },
      }),
      prisma.duesPayment.aggregate({
        where: { organizationId },
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.category.count({
        where: { organizationId, type: "DUES" },
      }),
      prisma.category.count({
        where: { organizationId, type: "MEMBERSHIP" },
      }),
    ]);

  const outstanding =
    Number(chargeSummary._sum.amountDue ?? 0) - Number(chargeSummary._sum.amountPaid ?? 0);

  return (
    <main className="space-y-6">
      <PageHeader
        title={terminology.duesLabel}
        description={`Membership billing overview with account setup, charge tracking, payment application, and category-linked ${terminology.duesLabel.toLowerCase()} plans.`}
        actions={[
          { href: "/dues/payments/new", label: `Record ${terminology.duesLabel} Payment`, tone: "primary" },
          { href: "/dues/generate", label: `Generate ${terminology.duesLabel} Charges` },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Dues Accounts" value={accountCount} />
        <StatCard label="Charges" value={chargeSummary._count.id} helper={formatCurrency(chargeSummary._sum.amountDue)} />
        <StatCard label="Payments" value={paymentSummary._count.id} helper={formatCurrency(paymentSummary._sum.amount)} />
        <StatCard label="Outstanding" value={formatCurrency(outstanding)} />
      </div>

      <SectionCard title="Setup and Workflow" description="Use category-based setup for standardized dues plans, then assign accounts, create charges, and apply payments.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Link href="/settings/dues" className="rounded-xl border border-slate-300 bg-white p-4 hover:bg-slate-50">
            <p className="text-sm font-semibold text-slate-950">Dues Setup</p>
            <p className="mt-2 text-sm text-slate-700">{duesCategories} dues categories and {membershipCategories} membership categories configured.</p>
          </Link>
          <Link href="/dues/accounts" className="rounded-xl border border-slate-300 bg-white p-4 hover:bg-slate-50">
            <p className="text-sm font-semibold text-slate-950">Dues Accounts</p>
            <p className="mt-2 text-sm text-slate-700">Assign a member or shared plan to a recurring billing account.</p>
          </Link>
          <Link href="/dues/charges" className="rounded-xl border border-slate-300 bg-white p-4 hover:bg-slate-50">
            <p className="text-sm font-semibold text-slate-950">Dues Charges</p>
            <p className="mt-2 text-sm text-slate-700">Issue charges with due dates and monitor outstanding balances.</p>
          </Link>
          <Link href="/dues/payments" className="rounded-xl border border-slate-300 bg-white p-4 hover:bg-slate-50">
            <p className="text-sm font-semibold text-slate-950">Dues Payments</p>
            <p className="mt-2 text-sm text-slate-700">Record payment methods and apply receipts to open charges.</p>
          </Link>
          <Link href="/dues/payments/new" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 hover:bg-emerald-100">
            <p className="text-sm font-semibold text-emerald-950">Pay Dues</p>
            <p className="mt-2 text-sm text-emerald-900">Record a member payment and apply it to a charge or dues account.</p>
          </Link>
          <Link href="/dues/generate" className="rounded-xl border border-slate-300 bg-white p-4 hover:bg-slate-50">
            <p className="text-sm font-semibold text-slate-950">Generate Dues Charges</p>
            <p className="mt-2 text-sm text-slate-700">Accrue missing dues from join dates and run delinquency evaluation.</p>
          </Link>
        </div>
      </SectionCard>
    </main>
  );
}
