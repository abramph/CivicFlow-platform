import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { formatDateTime } from "@/lib/formatting";
import { getSystemHealth } from "@/lib/platform-operations/health";
import { Breadcrumbs, StatusPill } from "@/components/admin/OperationsUI";

export default async function PlatformHealthPage() {
  await requireSuperAdmin();

  // Every individual check in getSystemHealth() catches its own errors and
  // returns a degraded/unavailable status rather than throwing — one failed
  // integration (e.g. Stripe timing out) cannot take down this page or any
  // other check's result.
  const checks = await getSystemHealth();

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/admin/platform", label: "Overview" }, { label: "System Health" }]} />
      <PageHeader
        title="System Health"
        description="Live checks where safe and cheap; configuration-presence checks (labeled 'inferred') where a live probe would be slow, risky, or has no defined contract."
      />

      <SectionCard title={`${checks.length} systems checked`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Service</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Signal</th>
                <th scope="col" className="px-4 py-3">Response time</th>
                <th scope="col" className="px-4 py-3">Checked</th>
                <th scope="col" className="px-4 py-3">Message</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((check) => (
                <tr key={check.service} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-slate-900">{check.service}</td>
                  <td className="px-4 py-3"><StatusPill status={check.status} /></td>
                  <td className="px-4 py-3 capitalize text-slate-700">{check.freshness}</td>
                  <td className="px-4 py-3 text-slate-700">{check.responseTimeMs !== null ? `${check.responseTimeMs}ms` : "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{formatDateTime(check.checkedAt)}</td>
                  <td className="px-4 py-3 text-slate-700">{check.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
