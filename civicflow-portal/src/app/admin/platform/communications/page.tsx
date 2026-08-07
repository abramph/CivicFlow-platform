import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDateTime } from "@/lib/formatting";
import { getCommunicationsOperationsSummary } from "@/lib/platform-operations/communications";
import { Breadcrumbs, MetricValue, EmptyState } from "@/components/admin/OperationsUI";

export default async function PlatformCommunicationsPage() {
  await requireSuperAdmin();

  // This page makes no live Twilio/Brevo/Expo API calls at all — every
  // number here is sourced from local tables the provider integrations
  // already write to (SmsMessage, EmailReminderLog, MobileDeviceToken,
  // CommunicationLog). A provider outage therefore can't break this page;
  // it can only make these local numbers stale, which is exactly what the
  // System Health page's live checks are for.
  const summary = await getCommunicationsOperationsSummary();

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/admin/platform", label: "Overview" }, { label: "Communications" }]} />
      <PageHeader
        title="Communications"
        description={`Last ${summary.sms.windowDays} days, unless noted otherwise.`}
        actions={[
          { href: "/admin/platform/sms", label: "SMS Administration (credentials, per-org limits) →" },
          { href: "/admin/platform/whatsapp", label: "WhatsApp Administration (credentials, per-org limits) →" },
        ]}
      />

      <SectionCard title="SMS / Twilio">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Orgs with SMS enabled" value={<MetricValue metric={summary.sms.orgsWithSmsEnabled} format={(v) => v} />} />
          <StatCard label="Sent" value={<MetricValue metric={summary.sms.sent} format={(v) => v} />} />
          <StatCard label="Delivered" value={<MetricValue metric={summary.sms.delivered} format={(v) => v} />} />
          <StatCard label="Failed" value={<MetricValue metric={summary.sms.failed} format={(v) => v} />} />
          <StatCard label="Opt-outs" value={<MetricValue metric={summary.sms.optOuts} format={(v) => v} />} />
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-900">Usage by organization</p>
            <MetricValue
              metric={summary.sms.usageByOrganization}
              format={(rows) =>
                rows.length === 0 ? (
                  <EmptyState title="No SMS activity in this window" />
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {rows.map((r) => (
                      <li key={r.organizationId} className="flex items-center justify-between py-2">
                        <Link href={`/admin/platform/organizations/${r.organizationId}`} className="font-semibold text-emerald-700 hover:underline">
                          {r.organizationName}
                        </Link>
                        <span className="text-slate-700">{r.sent} sent · {r.failed} failed</span>
                      </li>
                    ))}
                  </ul>
                )
              }
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-900">Recent provider errors</p>
            <MetricValue
              metric={summary.sms.recentProviderErrors}
              format={(rows) =>
                rows.length === 0 ? (
                  <EmptyState title="No recent errors" />
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {rows.map((r) => (
                      <li key={r.id} className="py-2">
                        <p className="text-slate-900">{r.errorMessage}</p>
                        <p className="text-xs text-slate-500">{formatDateTime(r.occurredAt)}</p>
                      </li>
                    ))}
                  </ul>
                )
              }
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="WhatsApp / Twilio">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Orgs with WhatsApp enabled" value={<MetricValue metric={summary.whatsapp.orgsWithWhatsAppEnabled} format={(v) => v} />} />
          <StatCard label="Sent" value={<MetricValue metric={summary.whatsapp.sent} format={(v) => v} />} />
          <StatCard label="Delivered" value={<MetricValue metric={summary.whatsapp.delivered} format={(v) => v} />} />
          <StatCard label="Failed" value={<MetricValue metric={summary.whatsapp.failed} format={(v) => v} />} />
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-900">Usage by organization</p>
            <MetricValue
              metric={summary.whatsapp.usageByOrganization}
              format={(rows) =>
                rows.length === 0 ? (
                  <EmptyState title="No WhatsApp activity in this window" />
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {rows.map((r) => (
                      <li key={r.organizationId} className="flex items-center justify-between py-2">
                        <Link href={`/admin/platform/organizations/${r.organizationId}`} className="font-semibold text-emerald-700 hover:underline">
                          {r.organizationName}
                        </Link>
                        <span className="text-slate-700">{r.sent} sent · {r.failed} failed</span>
                      </li>
                    ))}
                  </ul>
                )
              }
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-900">Recent provider errors</p>
            <MetricValue
              metric={summary.whatsapp.recentProviderErrors}
              format={(rows) =>
                rows.length === 0 ? (
                  <EmptyState title="No recent errors" />
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {rows.map((r) => (
                      <li key={r.id} className="py-2">
                        <p className="text-slate-900">{r.errorMessage}</p>
                        <p className="text-xs text-slate-500">{formatDateTime(r.occurredAt)}</p>
                      </li>
                    ))}
                  </ul>
                )
              }
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Email / Brevo" description="Scope: dues, contribution, and renewal reminder emails only. Authentication emails (verification, password reset) are not durably logged in this codebase.">
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard label="Sent" value={<MetricValue metric={summary.email.sent} format={(v) => v} />} />
          <StatCard label="Failed" value={<MetricValue metric={summary.email.failed} format={(v) => v} />} />
        </div>
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-slate-900">Organizations with recent failures</p>
          <MetricValue
            metric={summary.email.organizationsWithConfigProblems}
            format={(rows) =>
              rows.length === 0 ? (
                <EmptyState title="No email delivery problems in this window" />
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {rows.map((r) => (
                    <li key={r.organizationId} className="flex items-center justify-between py-2">
                      <Link href={`/admin/platform/organizations/${r.organizationId}`} className="font-semibold text-emerald-700 hover:underline">
                        {r.organizationName}
                      </Link>
                      <span className="text-slate-700">{r.failureCount} failure(s)</span>
                    </li>
                  ))}
                </ul>
              )
            }
          />
        </div>
      </SectionCard>

      <SectionCard title="Push / Expo">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Registered tokens" value={<MetricValue metric={summary.push.registeredTokens} format={(v) => v} />} />
          <StatCard label="Sent (30 days)" value={<MetricValue metric={summary.push.sentLast30Days} format={(v) => v} />} helper="Only pushes sent via the member-notification path" />
          <StatCard label="Invalid tokens" value={<MetricValue metric={summary.push.invalidTokens} format={(v) => v} />} />
        </div>
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-slate-900">Usage by organization</p>
          <MetricValue
            metric={summary.push.usageByOrganization}
            format={(rows) =>
              rows.length === 0 ? (
                <EmptyState title="No push activity in this window" />
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {rows.map((r) => (
                    <li key={r.organizationId} className="flex items-center justify-between py-2">
                      <Link href={`/admin/platform/organizations/${r.organizationId}`} className="font-semibold text-emerald-700 hover:underline">
                        {r.organizationName}
                      </Link>
                      <span className="text-slate-700">{r.count}</span>
                    </li>
                  ))}
                </ul>
              )
            }
          />
        </div>
      </SectionCard>
    </main>
  );
}
