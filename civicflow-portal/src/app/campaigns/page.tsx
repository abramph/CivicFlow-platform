import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate, formatEnumLabel } from "@/lib/formatting";

export default async function CampaignsPage() {
  const { organizationId } = await requirePermission("campaigns:read");

  const campaigns = await prisma.campaign.findMany({
    where: { organizationId },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    take: 100,
    include: {
      _count: {
        select: {
          contributions: true,
        },
      },
    },
  });

  const contributionTotals = campaigns.length
    ? await prisma.contribution.groupBy({
        by: ["campaignId"],
        where: {
          organizationId,
          campaignId: {
            in: campaigns.map((campaign) => campaign.id),
          },
        },
        _sum: { amount: true },
        _count: { id: true },
      })
    : [];

  const totalsByCampaignId = new Map(
    contributionTotals.map((row) => [
      row.campaignId ?? "",
      {
        amount: Number(row._sum.amount ?? 0),
        count: row._count.id,
      },
    ])
  );

  const totalRaised = contributionTotals.reduce(
    (sum, row) => sum + Number(row._sum.amount ?? 0),
    0
  );

  return (
    <main className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Fundraising and advocacy campaigns scoped to the current organization."
        actions={[
          { href: "/campaigns/new", label: "New Campaign", tone: "primary" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Campaigns" value={campaigns.length} />
        <StatCard label="Total Raised" value={formatCurrency(totalRaised)} />
        <StatCard
          label="Active Campaigns"
          value={campaigns.filter((campaign) => campaign.status.toLowerCase() === "active").length}
        />
      </div>

      <SectionCard title="Campaign List" description="Each campaign is filtered by the active organization from the authenticated session.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3">Goal</th>
                <th className="px-4 py-3">Raised</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-600">
                    No campaigns have been created yet.
                  </td>
                </tr>
              ) : (
                campaigns.map((campaign) => {
                  const totals = totalsByCampaignId.get(campaign.id);
                  return (
                    <tr key={campaign.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 text-slate-950">
                        <Link href={`/campaigns/${campaign.id}`} className="font-semibold text-emerald-700 hover:underline">
                          {campaign.name}
                        </Link>
                        {campaign.description ? (
                          <p className="mt-1 max-w-md text-xs leading-5 text-slate-700">
                            {campaign.description}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-900">{formatEnumLabel(campaign.status)}</td>
                      <td className="px-4 py-3 text-slate-900">
                        {formatDate(campaign.startDate)} to {formatDate(campaign.endDate)}
                      </td>
                      <td className="px-4 py-3 text-slate-900">{formatCurrency(campaign.goal)}</td>
                      <td className="px-4 py-3 text-slate-900">
                        {formatCurrency(totals?.amount ?? 0)}
                        <p className="text-xs text-slate-700">{totals?.count ?? 0} contributions</p>
                      </td>
                      <td className="px-4 py-3 text-slate-900">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/campaigns/${campaign.id}`}
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium hover:bg-slate-50"
                          >
                            View
                          </Link>
                          <Link
                            href={`/campaigns/${campaign.id}/edit`}
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium hover:bg-slate-50"
                          >
                            Edit
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
