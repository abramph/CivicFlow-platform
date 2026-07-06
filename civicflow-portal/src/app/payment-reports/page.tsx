import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { PaymentReportActions } from "@/components/forms/PaymentReportActions";
import { formatCurrency, formatDate, formatEnumLabel, formatPersonName } from "@/lib/formatting";

const TABS = ["pending", "approved", "rejected"] as const;

export default async function PaymentReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { organizationId, can } = await requirePermission("dues:read");
  const resolved = await searchParams;
  const status = (TABS as readonly string[]).includes(resolved.status ?? "") ? resolved.status : "pending";

  const [reports, counts] = await Promise.all([
    prisma.paymentReport.findMany({
      where: { organizationId, status: status as (typeof TABS)[number] },
      orderBy: { createdAt: "desc" },
      include: {
        member: { select: { id: true, firstName: true, lastName: true, email: true } },
        reviewedBy: { select: { displayName: true, email: true } },
        receiptAttachment: { select: { id: true, fileName: true } },
      },
      take: 200,
    }),
    Promise.all(TABS.map((tab) => prisma.paymentReport.count({ where: { organizationId, status: tab } }))),
  ]);

  const canReview = can("dues:write");

  return (
    <main className="space-y-6">
      <PageHeader
        title="Payment Reports"
        description="Payments members reported from the mobile app, awaiting treasurer review."
        actions={[
          { href: "/dues/reminders", label: "Dues Campaigns" },
          { href: "/dues", label: "Back to Dues" },
        ]}
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
            href={`/payment-reports?status=${tab}`}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              status === tab ? "bg-emerald-700 text-white" : "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            }`}
          >
            {formatEnumLabel(tab)}
          </Link>
        ))}
      </div>
      <SectionCard title={`${formatEnumLabel(status)} Reports`} description="Approving a Membership Dues report applies it to the member's oldest outstanding charge automatically; every other category records a Contribution instead.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Payment Date</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Note</th>
                <th className="px-4 py-3">Receipt</th>
                {status !== "pending" ? <th className="px-4 py-3">Reviewed By</th> : null}
                {canReview && status === "pending" ? <th className="px-4 py-3">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-slate-600">No {status} payment reports.</td></tr>
              ) : reports.map((report) => (
                <tr key={report.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <Link href={`/members/${report.member.id}`} className="font-semibold text-emerald-700 hover:underline">
                      {formatPersonName(report.member)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{formatEnumLabel(report.category)}</td>
                  <td className="px-4 py-3">{formatCurrency(report.amount)}</td>
                  <td className="px-4 py-3">{formatEnumLabel(report.paymentMethod)}</td>
                  <td className="px-4 py-3">{formatDate(report.paymentDate)}</td>
                  <td className="px-4 py-3">{report.referenceNumber || "-"}</td>
                  <td className="px-4 py-3 max-w-xs truncate">{report.note || "-"}</td>
                  <td className="px-4 py-3">
                    {report.receiptAttachment ? (
                      <Link href={`/api/attachments/${report.receiptAttachment.id}/download`} className="text-emerald-700 hover:underline">
                        View
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
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
                      <PaymentReportActions reportId={report.id} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
