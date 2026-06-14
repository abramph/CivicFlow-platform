import { requireSuperAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDate, formatDateTime, formatEnumLabel } from "@/lib/formatting";

export default async function PlatformAdminPage() {
  await requireSuperAdmin();

  const [organizations, usersCount, subscriptions, recentAuditEvents] = await Promise.all([
    prisma.organization.findMany({
      orderBy: [{ createdAt: "desc" }],
      include: {
        _count: {
          select: {
            members: true,
            memberships: true,
            contributions: true,
          },
        },
      },
      take: 50,
    }),
    prisma.user.count(),
    prisma.subscription.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: 50,
    }),
    prisma.auditEvent.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: 50,
    }),
  ]);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Platform Administration"
        description="Super-admin overview of organizations, users, subscriptions, and recent platform activity."
        actions={[{ href: "/dashboard", label: "Back to Dashboard" }]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Organizations" value={organizations.length} />
        <StatCard label="Users" value={usersCount} />
        <StatCard label="Subscriptions" value={subscriptions.length} />
        <StatCard label="Recent Audit Events" value={recentAuditEvents.length} />
      </div>

      <SectionCard title="Organizations" description="Current organizations on the platform, including member counts and contribution volume.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Organization</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Users</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Contributions</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((organization) => (
                <tr key={organization.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-900">
                    <p className="font-semibold">{organization.name}</p>
                    <p className="text-xs text-slate-700">{organization.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(organization.plan)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(organization.status)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatDate(organization.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-900">{organization._count.memberships}</td>
                  <td className="px-4 py-3 text-slate-900">{organization._count.members}</td>
                  <td className="px-4 py-3 text-slate-900">{organization._count.contributions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Subscriptions" description="Current Stripe subscription metadata tracked by the SaaS billing layer.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Subscription</th>
                <th className="px-4 py-3">Period End</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-600">
                    No subscriptions tracked yet.
                  </td>
                </tr>
              ) : (
                subscriptions.map((subscription) => (
                  <tr key={subscription.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(subscription.plan)}</td>
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(subscription.status)}</td>
                    <td className="px-4 py-3 text-slate-900">{subscription.stripeCustomerId ?? "Not linked"}</td>
                    <td className="px-4 py-3 text-slate-900">{subscription.stripeSubscriptionId ?? "Not linked"}</td>
                    <td className="px-4 py-3 text-slate-900">{formatDate(subscription.currentPeriodEnd)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Recent Platform Activity" description="Latest audit entries across organizations for super-admin visibility.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Resource</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Organization</th>
              </tr>
            </thead>
            <tbody>
              {recentAuditEvents.map((event) => (
                <tr key={event.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-900">{formatDateTime(event.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-900">{event.action}</td>
                  <td className="px-4 py-3 text-slate-900">{event.resource}</td>
                  <td className="px-4 py-3 text-slate-900">{event.actorEmail ?? "system"}</td>
                  <td className="px-4 py-3 text-slate-900">{event.organizationId ?? "platform"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
