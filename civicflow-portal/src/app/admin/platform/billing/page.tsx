import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDate, formatCurrency, formatEnumLabel } from "@/lib/formatting";
import { listSubscriptions, getBillingOperationsSummary } from "@/lib/platform-operations/billing";
import { Breadcrumbs, Pagination, StatusPill, MetricValue, EmptyState } from "@/components/admin/OperationsUI";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

export default async function PlatformBillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSuperAdmin();

  const params = await searchParams;
  const get = (key: string) => (Array.isArray(params[key]) ? params[key]?.[0] : params[key]) ?? "";
  const status = get("status");
  const plan = get("plan");
  const page = Number(get("page")) || 1;

  const [summary, subscriptions] = await Promise.all([
    getBillingOperationsSummary(),
    listSubscriptions({ status: status || undefined, plan: plan || undefined }, { page, pageSize: 25 }),
  ]);

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/admin/platform", label: "Overview" }, { label: "Billing" }]} />
      <PageHeader
        title="Billing"
        description="Local subscription records are the primary source of truth. Live Stripe calls are limited to the integration-health check and per-object dashboard links."
      />

      <SectionCard title="Status summary">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <StatCard label="Active" value={summary.statusSummary.active} />
          <StatCard label="Trialing" value={summary.statusSummary.trialing} />
          <StatCard label="Past due" value={summary.statusSummary.pastDue} />
          <StatCard label="Cancelled" value={summary.statusSummary.cancelled} />
          <StatCard label="Unpaid" value={summary.statusSummary.unpaid} />
          <StatCard
            label="Estimated MRR"
            value={<MetricValue metric={summary.estimatedMrr} format={(v) => formatCurrency(v.cents / 100)} />}
            helper="Base plan price only, active subscriptions — excludes seats, add-ons, discounts. See docs/aph-operations-center.md."
          />
        </div>
      </SectionCard>

      <SectionCard title="Stripe integration health">
        <MetricValue metric={summary.stripeIntegrationHealth} format={(v) => (v.configured ? <StatusPill status="healthy" label="Configured" /> : null)} />
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Trials ending within 14 days">
          {summary.trialsEndingSoon.length === 0 ? (
            <EmptyState title="No trials ending soon" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {summary.trialsEndingSoon.map((t) => (
                <li key={t.organizationId} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/admin/platform/organizations/${t.organizationId}`} className="font-semibold text-emerald-700 hover:underline">
                    {t.organizationName}
                  </Link>
                  <span className="text-slate-700">{formatDate(t.trialEndsAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Paid plan, no Stripe linkage" description="Organizations on a paid plan with zero Subscription rows.">
          {summary.organizationsMissingStripeLinkage.length === 0 ? (
            <EmptyState title="No linkage problems found" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {summary.organizationsMissingStripeLinkage.map((o) => (
                <li key={o.organizationId} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/admin/platform/organizations/${o.organizationId}`} className="font-semibold text-emerald-700 hover:underline">
                    {o.organizationName}
                  </Link>
                  <span className="text-slate-700">{formatEnumLabel(o.plan)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Recent invoice failures">
        <MetricValue metric={summary.recentInvoiceFailures} format={(items) => `${items.length} recorded`} />
      </SectionCard>

      <SectionCard title="Plan distribution">
        <div className="flex flex-wrap gap-2">
          {summary.planDistribution.map((p) => (
            <span key={p.plan} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-800">
              {formatEnumLabel(p.plan)}: {p.count}
            </span>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Filter subscriptions">
        <form className="grid gap-4 md:grid-cols-3" action="/admin/platform/billing" method="get">
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Status</span>
            <select name="status" defaultValue={status} className={inputClass}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="trialing">Trialing</option>
              <option value="past_due">Past due</option>
              <option value="cancelled">Cancelled</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Plan</span>
            <select name="plan" defaultValue={plan} className={inputClass}>
              <option value="">All plans</option>
              <option value="essential">Essential</option>
              <option value="elite">Elite</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
              Apply
            </button>
            <Link href="/admin/platform/billing" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
              Clear
            </Link>
          </div>
        </form>
      </SectionCard>

      <SectionCard title={`${subscriptions.items.length} of ${subscriptions.pagination.totalCount} subscription record(s)`}>
        {subscriptions.items.length === 0 ? (
          <EmptyState title="No subscriptions match these filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th scope="col" className="px-4 py-3">Organization</th>
                  <th scope="col" className="px-4 py-3">Plan</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Period end</th>
                  <th scope="col" className="px-4 py-3">Stripe</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.items.map((sub) => (
                  <tr key={sub.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/platform/organizations/${sub.organizationId}`} className="font-semibold text-emerald-700 hover:underline">
                        {sub.organizationName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(sub.plan)}</td>
                    <td className="px-4 py-3"><StatusPill status={sub.status} /></td>
                    <td className="px-4 py-3 text-slate-700">{formatDate(sub.currentPeriodEnd)}</td>
                    <td className="px-4 py-3">
                      {sub.stripeDashboardUrl ? (
                        <a href={sub.stripeDashboardUrl} target="_blank" rel="noreferrer" className="font-semibold text-emerald-700 hover:underline">
                          View →
                        </a>
                      ) : (
                        <span className="text-slate-500">Not linked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4">
          <Pagination basePath="/admin/platform/billing" searchParams={{ status, plan }} page={subscriptions.pagination.page} totalPages={subscriptions.pagination.totalPages} />
        </div>
      </SectionCard>
    </main>
  );
}
