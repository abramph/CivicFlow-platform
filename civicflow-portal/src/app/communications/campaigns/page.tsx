import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDateTime, formatEnumLabel } from "@/lib/formatting";

export default async function CommunicationCampaignsPage() {
  const { organizationId } = await requirePermission("communications:read");
  const campaigns = await prisma.communicationCampaign.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { recipients: true } } },
    take: 100,
  });
  return (
    <main className="space-y-6">
      <PageHeader title="Communication Campaigns" description="Create and send announcements, meeting minutes, dues reminders, event notices, and general communications." actions={[{ href: "/communications/new", label: "New Campaign", tone: "primary" }, { href: "/communications", label: "Communication Log" }]} />
      <div className="grid gap-4 md:grid-cols-3"><StatCard label="Campaigns" value={campaigns.length} /><StatCard label="Sent" value={campaigns.filter((row) => row.status === "SENT").length} /><StatCard label="Drafts" value={campaigns.filter((row) => row.status === "DRAFT").length} /></div>
      <SectionCard title="Campaigns" description="Delivery status and recipient counts are organization-scoped.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-4 py-3">Title</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Channel</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Recipients</th><th className="px-4 py-3">Created</th></tr></thead>
            <tbody>{campaigns.length === 0 ? <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-600">No campaigns yet.</td></tr> : campaigns.map((campaign) => <tr key={campaign.id} className="border-t border-slate-100"><td className="px-4 py-3"><Link href={`/communications/campaigns/${campaign.id}`} className="font-semibold text-emerald-700 hover:underline">{campaign.title}</Link></td><td className="px-4 py-3">{formatEnumLabel(campaign.communicationType)}</td><td className="px-4 py-3">{formatEnumLabel(campaign.channel)}</td><td className="px-4 py-3">{formatEnumLabel(campaign.status)}</td><td className="px-4 py-3">{campaign._count.recipients}</td><td className="px-4 py-3">{formatDateTime(campaign.createdAt)}</td></tr>)}</tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
