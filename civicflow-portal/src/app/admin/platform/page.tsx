import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDateTime, formatCurrency } from "@/lib/formatting";
import { getPlatformOverview } from "@/lib/platform-operations/overview";
import { getOperationalRisks } from "@/lib/platform-operations/risks";
import { MetricValue, StatusPill, EmptyState } from "@/components/admin/OperationsUI";

export default async function PlatformOverviewPage() {
  await requireSuperAdmin();

  const [overview, risks] = await Promise.all([getPlatformOverview(), getOperationalRisks()]);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Overview"
        description={`Platform-wide operational summary. Generated ${formatDateTime(overview.generatedAt)}.`}
      />

      {risks.length > 0 ? (
        <SectionCard title="Operational risks requiring attention" description="Deterministic, rule-based checks — not a security-incident feed.">
          <ul className="space-y-2">
            {risks.slice(0, 8).map((risk) => (
              <li key={risk.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={risk.severity} />
                    <p className="font-semibold text-slate-950">{risk.title}</p>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{risk.explanation}</p>
                </div>
                <Link href={risk.href} className="shrink-0 text-sm font-semibold text-emerald-700 hover:underline">
                  View →
                </Link>
              </li>
            ))}
          </ul>
          {risks.length > 8 ? <p className="mt-3 text-sm text-slate-600">{risks.length - 8} more risk(s) not shown here.</p> : null}
        </SectionCard>
      ) : null}

      <SectionCard title="Organizations">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Link href="/admin/platform/organizations"><StatCard label="Total" value={overview.organizations.total} /></Link>
          <Link href="/admin/platform/organizations?status=active"><StatCard label="Active" value={overview.organizations.active} /></Link>
          <Link href="/admin/platform/organizations?subscriptionStatus=trialing"><StatCard label="Trial" value={overview.organizations.trial} /></Link>
          <Link href="/admin/platform/organizations?status=suspended"><StatCard label="Suspended / Inactive" value={overview.organizations.suspendedOrInactive} /></Link>
          <Link href="/admin/platform/organizations?sort=createdAt"><StatCard label="New (30 days)" value={overview.organizations.createdLast30Days} /></Link>
        </div>
      </SectionCard>

      <SectionCard title="People">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Link href="/admin/platform/people"><StatCard label="Total users" value={overview.people.totalUsers} /></Link>
          <Link href="/admin/platform/people"><StatCard label="Active memberships" value={overview.people.activeMemberships} /></Link>
          <Link href="/admin/platform/organizations"><StatCard label="Pending invitations" value={overview.people.pendingInvitations} helper="Member-portal invites only" /></Link>
          <Link href="/admin/platform/people?onlyMultiOrg=1"><StatCard label="Multi-org users" value={overview.people.multiOrgUsers} /></Link>
          <Link href="/admin/platform/people"><StatCard label="New (30 days)" value={overview.people.createdLast30Days} /></Link>
        </div>
      </SectionCard>

      <SectionCard title="Billing">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Link href="/admin/platform/billing?status=active"><StatCard label="Active subscriptions" value={overview.billing.active} /></Link>
          <Link href="/admin/platform/billing?status=trialing"><StatCard label="Trialing" value={overview.billing.trialing} /></Link>
          <Link href="/admin/platform/billing?status=past_due"><StatCard label="Past due" value={overview.billing.pastDue} /></Link>
          <Link href="/admin/platform/billing?status=cancelled"><StatCard label="Canceled" value={overview.billing.canceled} /></Link>
          <Link href="/admin/platform/billing">
            <StatCard
              label="Estimated MRR"
              value={<MetricValue metric={overview.billing.estimatedMrr} format={(v) => formatCurrency(v.cents / 100)} />}
              helper="Base plan price only — excludes seats/add-ons. See Billing page."
            />
          </Link>
        </div>
      </SectionCard>

      <SectionCard title="Communications" description={`Last ${overview.communications.windowDays} days.`}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Link href="/admin/platform/communications">
            <StatCard label="SMS sent" value={<MetricValue metric={overview.communications.smsSent} format={(v) => v} />} />
          </Link>
          <Link href="/admin/platform/communications">
            <StatCard label="SMS failed" value={<MetricValue metric={overview.communications.smsFailed} format={(v) => v} />} />
          </Link>
          <Link href="/admin/platform/communications">
            <StatCard
              label="Email sent"
              value={<MetricValue metric={overview.communications.emailSent} format={(v) => v} />}
              helper="Reminder emails only — see Communications page"
            />
          </Link>
          <Link href="/admin/platform/communications">
            <StatCard label="Email failed" value={<MetricValue metric={overview.communications.emailFailed} format={(v) => v} />} />
          </Link>
          <Link href="/admin/platform/communications">
            <StatCard label="Push sent" value={<MetricValue metric={overview.communications.pushSent} format={(v) => v} />} />
          </Link>
          <Link href="/admin/platform/communications">
            <StatCard label="SMS opt-outs" value={<MetricValue metric={overview.communications.smsOptOuts} format={(v) => v} />} />
          </Link>
        </div>
      </SectionCard>

      <SectionCard title="Operations">
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/admin/platform/jobs">
            <StatCard
              label="Failed jobs (7 days)"
              value={<MetricValue metric={overview.operations.failedJobsLast7Days} format={(v) => v} />}
              helper="See Background Operations"
            />
          </Link>
          <Link href="/admin/platform/health">
            <StatCard label="Integration health" value="View status →" helper="Live checks on the System Health page" />
          </Link>
        </div>
      </SectionCard>

      <SectionCard title="Recent platform activity">
        {overview.recentActivity.length === 0 ? (
          <EmptyState title="No recent activity" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {overview.recentActivity.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <p className="font-semibold text-slate-900">{item.label}</p>
                  <p className="text-slate-600">{item.detail}</p>
                </div>
                <p className="shrink-0 text-slate-500">{formatDateTime(item.occurredAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </main>
  );
}
