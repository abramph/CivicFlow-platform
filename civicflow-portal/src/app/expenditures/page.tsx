import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate, formatText } from "@/lib/formatting";

export default async function ExpendituresPage() {
  const { organizationId } = await requirePermission("expenditures:read");

  const rows = await prisma.expenditure.findMany({
    where: { organizationId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { categoryRef: true, paymentMethodConfig: true, campaign: true, event: true },
    take: 100,
  });

  const totalSpent = rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const categoryCount = new Set(rows.map((row) => row.category).filter(Boolean)).size;

  return (
    <main className="space-y-6">
      <PageHeader
        title="Expenditures"
        description="Outgoing spending records scoped to the active organization."
        actions={[
          { href: "/expenditures/new", label: "Add Expenditure", tone: "primary" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Expenditures" value={rows.length} />
        <StatCard label="Total Spent" value={formatCurrency(totalSpent)} />
        <StatCard label="Expense Categories" value={categoryCount} />
      </div>

      <SectionCard title="Expense Ledger" description="Vendor, category, amount, and supporting detail for recent expenditures.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Vendor / Payee</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Supporting Record</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-600">
                    No expenditures have been recorded yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{formatDate(row.date)}</td>
                    <td className="px-4 py-3 text-slate-900">
                      <Link href={`/expenditures/${row.id}`} className="font-semibold text-emerald-700 hover:underline">
                        {formatText(row.vendor, "Direct expense")}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-900">{row.description}</td>
                    <td className="px-4 py-3 text-slate-900">{formatText(row.categoryRef?.name ?? row.category, "Uncategorized")}</td>
                    <td className="px-4 py-3 text-slate-900">{formatCurrency(row.amount)}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {row.receiptUrl ? (
                        <Link href={row.receiptUrl} className="text-emerald-700 hover:underline">
                          View receipt
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
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
