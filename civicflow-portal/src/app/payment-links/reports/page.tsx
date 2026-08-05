import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { PaymentLinkOfflineReportActions } from "@/components/forms/PaymentLinkOfflineReportActions";
import { formatCurrency, formatDate, formatEnumLabel } from "@/lib/formatting";

const TABS = ["pending", "approved", "rejected"] as const;

export default async function PaymentLinkReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { organizationId, can } = await requirePermission("payment_link_reports:review");
  const resolved = await searchParams;
  const status = (TABS as readonly string[]).includes(resolved.status ?? "") ? resolved.status : "pending";

  const [reports, counts] = await Promise.all([
    prisma.paymentLinkOfflineReport.findMany({
      where: { organizationId, status: status as (typeof TABS)[number] },
      orderBy: { createdAt: "desc" },
      include: {
        paymentLink: { select: { id: true, title: true, slug: true } },
        paymentMethodConfig: { select: { method: true, label: true } },
        reviewedBy: { select: { displayName: true, email: true } },
      },
      take: 200,
    }),
    Promise.all(TABS.map((tab) => prisma.paymentLinkOfflineReport.count({ where: { organizationId, status: tab } }))),
  ]);

  const canReview = can("payment_link_reports:review");

  return (
    <main className="space-y-6">
      <PageHeader
        title="Payment Link Reports"
        description="Offline payments the public reported against your Payment Links, awaiting review. Approving creates a Contribution; nothing is marked paid until you review it."
        actions={[{ href: "/payment-links", label: "Back to Payment Links" }]}
      />
      <div className="grid gap-4 md:grid-cols-3">
        {TABS.map((tab, index) => (
          <StatCard key={tab} label={formatEnumLabel(tab)} value={counts[index]} />
        ))}
      </div>
      <div className="flex gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={`/payment-links/reports?status=${tab}`}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              status === tab ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            }`}
          >
            {formatEnumLabel(tab)}
          </Link>
        ))}
      </div>
      <SectionCard title={`${formatEnumLabel(status)} Reports`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Payer</th>
                <th className="px-4 py-3">Payment Link</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Message</th>
                <th className="px-4 py-3">Submitted</th>
                {status !== "pending" ? <th className="px-4 py-3">Reviewed By</th> : null}
                {canReview && status === "pending" ? <th className="px-4 py-3">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-600">
                    No {status} payment link reports.
                  </td>
                </tr>
              ) : (
                reports.map((report) => (
                  <tr key={report.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{report.payerName}</p>
                      <p className="text-xs text-slate-500">{report.payerEmail}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/payment-links/${report.paymentLink.id}`}
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        {report.paymentLink.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{report.paymentMethodConfig.label}</td>
                    <td className="px-4 py-3">{formatCurrency(report.amount)}</td>
                    <td className="px-4 py-3">{report.referenceNumber || "-"}</td>
                    <td className="px-4 py-3 max-w-xs truncate">{report.message || "-"}</td>
                    <td className="px-4 py-3">{formatDate(report.createdAt)}</td>
                    {status !== "pending" ? (
                      <td className="px-4 py-3">
                        {report.reviewedBy?.displayName || report.reviewedBy?.email || "-"}
                        {report.status === "rejected" && report.rejectionReason ? (
                          <p className="text-xs text-red-700">{report.rejectionReason}</p>
                        ) : null}
                      </td>
                    ) : null}
                    {canReview && status === "pending" ? (
                      <td className="px-4 py-3">
                        <PaymentLinkOfflineReportActions reportId={report.id} />
                      </td>
                    ) : null}
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
