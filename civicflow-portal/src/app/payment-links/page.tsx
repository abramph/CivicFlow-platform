import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatCurrency, formatDate, formatEnumLabel } from "@/lib/formatting";
import { prisma } from "@/lib/prisma";
import { canDo } from "@/lib/rbac";

export default async function PaymentLinksPage() {
  const { organizationId, role } = await requirePermission("contributions:read");

  const [organization, subscription, contributionSummary, recentContributions] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        plan: true,
        status: true,
        createdAt: true,
        _count: {
          select: {
            members: true,
            campaigns: true,
            events: true,
            contributions: true,
          },
        },
      },
    }),
    prisma.subscription.findFirst({
      where: { organizationId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.contribution.aggregate({
      where: { organizationId },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.contribution.findMany({
      where: { organizationId },
      orderBy: [{ contributionDate: "desc" }, { createdAt: "desc" }],
      include: {
        member: true,
        campaign: true,
        event: true,
      },
      take: 5,
    }),
  ]);

  const actions = [
    { href: "/dashboard", label: "Back to Dashboard" },
    { href: "/contributions", label: "Contributions" },
    { href: "/payments", label: "Pending Payments" },
  ];

  if (canDo(role, "billing:read")) {
    actions.push({ href: "/settings/billing", label: "Billing Settings" });
  }

  if (!organization) {
    return (
      <main className="space-y-6">
        <PageHeader
          title="Payment Links"
          description="Your organization record could not be loaded, so payment-link setup details are unavailable."
          actions={actions}
        />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title="Payment Links"
        description="Current payment-link setup view for this organization, including plan, collection destinations, and related payment workflows."
        actions={actions}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Organization Plan" value={formatEnumLabel(organization.plan)} />
        <StatCard
          label="Subscription Status"
          value={subscription ? formatEnumLabel(subscription.status) : "No subscription record"}
        />
        <StatCard
          label="Contribution Volume"
          value={formatCurrency(contributionSummary._sum.amount)}
          helper={`${contributionSummary._count.id} recorded contributions`}
        />
        <StatCard
          label="Link Destinations"
          value={`${organization._count.campaigns} campaigns / ${organization._count.events} events`}
          helper={`${organization._count.members} members in the org`}
        />
      </div>

      <SectionCard title="Current Setup" description="This workspace does not yet store dedicated payment-link rows, so this page focuses on the live SaaS data that supports link-based collection today.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Organization Status" value={formatEnumLabel(organization.status)} />
          <StatCard label="Portal Access Since" value={formatDate(organization.createdAt)} />
          <StatCard label="Campaign Destinations" value={organization._count.campaigns} />
          <StatCard label="Event Destinations" value={organization._count.events} />
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800">
          <p className="font-semibold text-slate-950">What this page confirms now</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Contribution collection is active in the SaaS data model for this organization.</li>
            <li>Campaign and event records exist as attribution targets for future hosted payment links.</li>
            <li>The legacy cloud payment approval queue remains available from <Link href="/payments" className="font-semibold text-emerald-700 hover:underline">/payments</Link>.</li>
            <li>Billing controls remain under <Link href="/settings/billing" className="font-semibold text-emerald-700 hover:underline">/settings/billing</Link> when your role allows it.</li>
          </ul>
        </div>
      </SectionCard>

      <SectionCard title="Recent Revenue Activity" description="Recent contributions that would be natural destinations for payment-link traffic once managed links are introduced.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {recentContributions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-600">
                    No contribution activity has been recorded yet.
                  </td>
                </tr>
              ) : (
                recentContributions.map((contribution) => (
                  <tr key={contribution.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{formatDate(contribution.contributionDate)}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {contribution.member
                        ? `${contribution.member.lastName}, ${contribution.member.firstName}`
                        : "Unattributed"}
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      {contribution.campaign?.name || contribution.event?.title || "Direct contribution"}
                    </td>
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(contribution.source)}</td>
                    <td className="px-4 py-3 text-slate-900">{formatCurrency(contribution.amount)}</td>
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
