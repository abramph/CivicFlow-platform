import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatCurrency, formatDate, formatEnumLabel } from "@/lib/formatting";
import { getPaymentMethodCategory } from "@/lib/payment-method-links";
import { prisma } from "@/lib/prisma";
import { getServerEnv } from "@/lib/env";

const categoryBadgeClass: Record<ReturnType<typeof getPaymentMethodCategory>, string> = {
  native: "bg-emerald-100 text-emerald-800",
  external: "bg-blue-100 text-blue-800",
  offline: "bg-slate-100 text-slate-700",
};

export default async function PaymentLinksPage() {
  const { organizationId, can } = await requirePermission("contributions:read");
  const env = getServerEnv();
  const baseUrl = env.NEXTAUTH_URL.replace(/\/$/, "");

  const [links, pendingReportCount] = await Promise.all([
    prisma.paymentLink.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        campaign: { select: { id: true, name: true } },
        event: { select: { id: true, title: true } },
        methods: { include: { paymentMethodConfig: { select: { method: true, label: true } } } },
      },
    }),
    prisma.paymentLinkOfflineReport.count({ where: { organizationId, status: "pending" } }),
  ]);

  const canReviewReports = can("payment_link_reports:review");

  const active = links.filter((l) => l.status === "active").length;
  const totalUses = links.reduce((sum, l) => sum + l.useCount, 0);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Payment Links"
        description="Shareable links that let people pay your organization using one or more methods you offer — online card payment, external redirect, or offline instructions."
        actions={[
          { href: "/payment-links/new", label: "New Payment Link", tone: "primary" },
          ...(canReviewReports
            ? [{ href: "/payment-links/reports", label: `Review Reports${pendingReportCount ? ` (${pendingReportCount})` : ""}` }]
            : []),
          { href: "/contributions", label: "Contributions" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Total Links" value={links.length} />
        <StatCard label="Active Links" value={active} />
        <StatCard label="Total Uses" value={totalUses} />
        <StatCard label="Pending Reports" value={pendingReportCount} />
      </div>

      <SectionCard title="Payment Links" description="Share the URL for any link below. Payers choose from the payment options you've enabled for it.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Payment Options</th>
                <th className="px-4 py-3">Attribution</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Uses</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {links.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-600">
                    No payment links yet.{" "}
                    <Link href="/payment-links/new" className="font-semibold text-emerald-700 hover:underline">
                      Create your first one.
                    </Link>
                  </td>
                </tr>
              ) : (
                links.map((link) => (
                  <tr key={link.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <Link
                        href={`/payment-links/${link.id}`}
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        {link.title}
                      </Link>
                      <p className="mt-0.5 font-mono text-xs text-slate-500">
                        {baseUrl}/pay/{link.slug}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(link.linkType)}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {link.amount ? formatCurrency(link.amount) : "Flexible"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {link.methods.length === 0 ? (
                          <span className="text-xs text-slate-400">None</span>
                        ) : (
                          link.methods.map((m) => (
                            <span
                              key={m.paymentMethodConfigId}
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${categoryBadgeClass[getPaymentMethodCategory(m.paymentMethodConfig.method)]}`}
                            >
                              {m.paymentMethodConfig.label}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      {link.campaign?.name ?? link.event?.title ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          link.status === "active"
                            ? "bg-emerald-100 text-emerald-800"
                            : link.status === "inactive"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {formatEnumLabel(link.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-900">{link.useCount}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {link.expiresAt ? formatDate(link.expiresAt) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/payment-links/${link.id}`}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                        >
                          View
                        </Link>
                        <Link
                          href={`/payment-links/${link.id}/edit`}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                        >
                          Edit
                        </Link>
                      </div>
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
