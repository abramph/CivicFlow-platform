import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { AttachmentManager } from "@/components/forms/AttachmentManager";
import { prisma } from "@/lib/prisma";
import { canDo } from "@/lib/rbac";
import {
  formatCurrency,
  formatDate,
  formatEnumLabel,
  formatText,
} from "@/lib/formatting";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organizationId, role } = await requirePermission("campaigns:read");
  const { id } = await params;

  const [campaign, contributionSummary, contributions] = await Promise.all([
    prisma.campaign.findFirst({
      where: { id, organizationId },
    }),
    prisma.contribution.aggregate({
      where: { organizationId, campaignId: id },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.contribution.findMany({
      where: { organizationId, campaignId: id },
      orderBy: [{ contributionDate: "desc" }, { createdAt: "desc" }],
      include: {
        member: true,
        event: true,
      },
      take: 100,
    }),
  ]);

  if (!campaign) {
    return (
      <main className="space-y-6">
        <PageHeader
          title="Campaign not found"
          description="The requested campaign does not exist in your organization."
          actions={[
            { href: "/campaigns", label: "Back to Campaigns" },
            { href: "/dashboard", label: "Back to Dashboard" },
          ]}
        />
      </main>
    );
  }

  const raisedTotal = Number(contributionSummary._sum.amount ?? 0);
  const goalTotal = Number(campaign.goal ?? 0);
  const remainingTotal = goalTotal - raisedTotal;

  return (
    <main className="space-y-6">
      <PageHeader
        title={campaign.name}
        description="Campaign summary with contribution history scoped to the current organization."
        actions={[
          { href: `/campaigns/${campaign.id}/edit`, label: "Edit Campaign", tone: "primary" },
          { href: `/contributions/new?campaignId=${campaign.id}`, label: "Record Contribution" },
          { href: "/campaigns", label: "Back to Campaigns" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Status" value={formatEnumLabel(campaign.status)} />
        <StatCard label="Goal" value={formatCurrency(campaign.goal)} />
        <StatCard label="Raised" value={formatCurrency(raisedTotal)} />
        <StatCard label="Remaining" value={formatCurrency(remainingTotal)} helper={`${contributionSummary._count.id} contributions`} />
      </div>

      <SectionCard title="Campaign Overview" description="Core campaign metadata and purpose.">
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard label="Start Date" value={formatDate(campaign.startDate)} />
          <StatCard label="End Date" value={formatDate(campaign.endDate)} />
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-900">Description</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">
            {formatText(campaign.description, "No campaign description has been added yet.")}
          </p>
        </div>
        {campaign.notes ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-900">Notes</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{campaign.notes}</p>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Campaign Attachments" description="Store private campaign documents, collateral, and supporting files.">
        <AttachmentManager entityType="CAMPAIGN" entityId={campaign.id} canWrite={canDo(role, "campaigns:write")} />
      </SectionCard>

      <SectionCard title="Campaign Contributions" description="Contributions tied directly to this campaign.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Related Event</th>
                <th className="px-4 py-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {contributions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-600">
                    No contributions are linked to this campaign yet.
                  </td>
                </tr>
              ) : (
                contributions.map((contribution) => (
                  <tr key={contribution.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{formatDate(contribution.contributionDate)}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {contribution.member
                        ? `${contribution.member.lastName}, ${contribution.member.firstName}`
                        : (contribution.contributorName || "Non-member")}
                    </td>
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(contribution.source)}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {contribution.event ? (
                        <Link href={`/events/${contribution.event.id}`} className="text-emerald-700 hover:underline">
                          {contribution.event.title}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
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
