import { requirePermission } from "@/lib/auth-guards";
import { getGivingSettings } from "@/lib/giving/module";
import { getFinanceDashboard } from "@/lib/giving/finance-dashboard";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * CORE-GIVE-I (§37) — the organization finance dashboard. Renders only for
 * contributions:summary:view holders; aggregates only (individual giving
 * lives behind contributions:individual:view on its own surfaces).
 */
export default async function GivingDashboardPage() {
  const { organizationId } = await requirePermission("contributions:summary:view");

  const settings = await getGivingSettings(organizationId);
  if (!settings.contributionsEnabled) {
    return (
      <main className="space-y-6">
        <PageHeader title="Giving Dashboard" description="Enable Contributions & Giving in Settings first." />
      </main>
    );
  }

  const dashboard = await getFinanceDashboard(organizationId);
  const stats: { label: string; value: string; alert?: boolean }[] = [
    { label: "This Month", value: money(dashboard.thisMonth) },
    { label: "Year to Date", value: money(dashboard.yearToDate) },
    { label: "Active Recurring Contributors", value: String(dashboard.activeRecurringContributors) },
    { label: "Recurring Monthly Run Rate", value: money(dashboard.recurringMonthlyRunRate) },
    { label: "Pledged", value: money(dashboard.pledgedTotal) },
    { label: "Received Toward Pledges", value: money(dashboard.receivedTowardPledges) },
    {
      label: "Failed Contributions Needing Attention",
      value: String(dashboard.failedNeedingAttention),
      alert: dashboard.failedNeedingAttention > 0,
    },
  ];

  return (
    <main className="space-y-6">
      <PageHeader
        title={`${settings.terminology} Dashboard`}
        description="Organization-level giving activity. Totals only — individual giving history has its own permission."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{stat.label}</p>
            <p className={`mt-1 text-2xl font-bold ${stat.alert ? "text-amber-700" : "text-slate-900"}`}>{stat.value}</p>
          </div>
        ))}
      </div>
      <SectionCard title="Top Funds (Year to Date)" description="Where giving is being designated this year.">
        {dashboard.topFunds.length === 0 ? (
          <p className="text-sm text-slate-600">No fund-designated contributions yet this year.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {dashboard.topFunds.map((fund) => (
              <li key={fund.name} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium text-slate-900">{fund.name}</span>
                <span className="text-slate-700">{money(fund.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </main>
  );
}
