import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { paymentMethodLabels as defaultPaymentMethodLabels } from "@/lib/payment-methods";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import {
  formatCurrency,
  formatDate,
  formatEnumLabel,
  formatPersonName,
} from "@/lib/formatting";

export default async function ContributionsPage() {
  const { organizationId } = await requirePermission("contributions:read");

  const [rows, paymentMethods] = await Promise.all([
    prisma.contribution.findMany({
      where: { organizationId },
      orderBy: [{ contributionDate: "desc" }, { createdAt: "desc" }],
      include: {
        member: true,
        campaign: true,
        event: true,
      },
      take: 150,
    }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId },
      select: { method: true, label: true },
    }),
  ]);
  const methodLabels = Object.fromEntries(defaultPaymentMethodLabels);
  for (const method of paymentMethods) {
    methodLabels[method.method] = method.label;
  }

  const totalRaised = rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const receiptedCount = rows.filter((row) => row.receiptRequested).length;

  return (
    <main className="space-y-6">
      <PageHeader
        title="Contributions"
        description="Contribution ledger with member attribution, campaign/event context, payment method, and receipt follow-up."
        actions={[
          { href: "/contributions/new", label: "New Contribution", tone: "primary" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Contributions" value={rows.length} />
        <StatCard label="Total Raised" value={formatCurrency(totalRaised)} />
        <StatCard label="Receipt Requested" value={receiptedCount} />
        <StatCard label="Attributed to Members" value={rows.filter((row) => row.memberId).length} />
      </div>

      <SectionCard title="Contribution Ledger" description="All contribution rows are scoped by organizationId from the authenticated session.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Member attribution</th>
                <th className="px-4 py-3">Campaign / Event</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Payment method</th>
                <th className="px-4 py-3">Receipt</th>
                <th className="px-4 py-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-600" colSpan={7}>
                    No contributions have been recorded yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className={`border-t border-slate-100 ${row.voidedAt ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3 text-slate-900">
                      <Link href={`/contributions/${row.id}`} className="text-emerald-700 hover:underline">
                        {formatDate(row.contributionDate)}
                      </Link>
                      {row.voidedAt ? <span className="ml-2 text-xs font-semibold text-red-600">VOID</span> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      {row.member ? (
                        <Link href={`/members/${row.member.id}`} className="font-semibold text-emerald-700 hover:underline">
                          {formatPersonName(row.member)}
                        </Link>
                      ) : (
                        row.contributorName || "Non-member"
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      {row.campaign ? (
                        <Link href={`/campaigns/${row.campaign.id}`} className="text-emerald-700 hover:underline">
                          {row.campaign.name}
                        </Link>
                      ) : row.event ? (
                        <Link href={`/events/${row.event.id}`} className="text-emerald-700 hover:underline">
                          {row.event.title}
                        </Link>
                      ) : (
                        "Direct contribution"
                      )}
                      {row.notes ? <p className="mt-1 text-xs text-slate-700">{row.notes}</p> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(row.source)}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {row.paymentMethod ? methodLabels[row.paymentMethod] ?? formatEnumLabel(row.paymentMethod) : "Not specified"}
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      {row.receiptRequested ? (
                        <Link href="/receipts" className="text-emerald-700 hover:underline">
                          Requested
                        </Link>
                      ) : (
                        "Not requested"
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-900">{formatCurrency(row.amount)}</td>
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
