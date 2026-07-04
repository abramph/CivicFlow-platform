import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDateTime, formatEnumLabel } from "@/lib/formatting";

/**
 * "Dues Campaigns" / "Send Reminder" / "Reminder History" — a filtered view
 * of the existing Communications campaign system (communicationType =
 * DUES_REMINDER), rather than a separate reminder system to maintain.
 */
export default async function DuesRemindersPage() {
  const { organizationId } = await requirePermission("dues:read");
  const campaigns = await prisma.communicationCampaign.findMany({
    where: { organizationId, communicationType: "DUES_REMINDER" },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { recipients: true } } },
    take: 100,
  });

  return (
    <main className="space-y-6">
      <PageHeader
        title="Dues Campaigns"
        description="Send push/email dues reminders to members with outstanding balances, and review delivery history."
        actions={[
          { href: "/communications/new?preset=dues_reminder", label: "Send Reminder", tone: "primary" },
          { href: "/payment-reports", label: "Payment Reports" },
          { href: "/dues", label: "Back to Dues" },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Reminder Campaigns" value={campaigns.length} />
        <StatCard label="Sent" value={campaigns.filter((row) => row.status === "SENT").length} />
        <StatCard label="Scheduled" value={campaigns.filter((row) => row.status === "READY" && row.scheduledFor).length} />
      </div>
      <SectionCard title="Reminder History" description="Every dues reminder campaign sent or scheduled for this organization.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Push</th>
                <th className="px-4 py-3">Recipients</th>
                <th className="px-4 py-3">Scheduled For</th>
                <th className="px-4 py-3">Sent</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-600">No dues reminders sent yet.</td></tr>
              ) : campaigns.map((campaign) => (
                <tr key={campaign.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <Link href={`/communications/campaigns/${campaign.id}`} className="font-semibold text-emerald-700 hover:underline">
                      {campaign.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{formatEnumLabel(campaign.status)}</td>
                  <td className="px-4 py-3">{campaign.pushEnabled ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">{campaign._count.recipients}</td>
                  <td className="px-4 py-3">{campaign.scheduledFor ? formatDateTime(campaign.scheduledFor) : "—"}</td>
                  <td className="px-4 py-3">{campaign.sentAt ? formatDateTime(campaign.sentAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
