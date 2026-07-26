import Link from "next/link";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { formatDateTime } from "@/lib/formatting";

const STATUS_TONE: Record<string, string> = { DRAFT: "unknown", SCHEDULED: "info", SENT: "healthy", FAILED: "critical" };

export default async function PtaCommunicationsPage() {
  const { organizationId, access } = await getPtaPageGate("pta:announcements:publish");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Communications" description="Not available for this organization." />
      </main>
    );
  }

  const campaigns = await prisma.communicationCampaign.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, title: true, status: true, channel: true, createdAt: true },
  });

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Communications"
        description="Announcements are sent through the base platform's Communication Campaigns feature."
        actions={[{ href: "/communications/campaigns", label: "Create a campaign", tone: "primary" }]}
      />

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
        <p className="font-semibold">PTA-specific targeting isn&apos;t wired in yet</p>
        <p className="mt-1">
          A targeting engine exists to resolve recipients by grade, classroom, committee, an event&apos;s volunteers, or unpaid dues
          (<code>resolvePtaTargetMemberIds</code>), but the campaign creation form doesn&apos;t yet offer these as targeting options — it currently only
          supports a manually-entered recipient list. Wiring this in is flagged as a follow-up rather than built in this sprint, since it
          means adding an option to the base platform&apos;s campaign form, not just a PTA-only page.
        </p>
      </div>

      <SectionCard title="Recent campaigns" description={`${campaigns.length} campaign(s) for this organization.`}>
        {campaigns.length === 0 ? (
          <EmptyState title="No campaigns yet" description="Create your first announcement from the base Communications feature." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {campaigns.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <Link href={`/communications/campaigns/${c.id}`} className="font-semibold text-emerald-700 hover:underline">
                    {c.title}
                  </Link>
                  <p className="text-slate-600">{c.channel} · {formatDateTime(c.createdAt)}</p>
                </div>
                <StatusPill status={STATUS_TONE[c.status] ?? "unknown"} label={c.status} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </main>
  );
}
