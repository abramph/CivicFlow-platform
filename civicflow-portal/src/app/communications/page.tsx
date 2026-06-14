import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDateTime, formatEnumLabel, formatPersonName, formatText } from "@/lib/formatting";

export default async function CommunicationsPage() {
  const { organizationId } = await requirePermission("communications:read");
  const rows = await prisma.communicationLog.findMany({
    where: { organizationId },
    orderBy: [{ communicationDate: "desc" }, { createdAt: "desc" }],
    include: { member: true, campaign: true, event: true },
    take: 150,
  });
  const followUps = rows.filter((row) => row.followUpRequired);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Communications"
        description="Track member, campaign, event, and internal communication history."
        actions={[
          { href: "/communications/new", label: "New Communication", tone: "primary" },
          { href: "/communications/campaigns", label: "Campaigns" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Communications" value={rows.length} />
        <StatCard label="Follow-ups" value={followUps.length} />
        <StatCard label="Outbound" value={rows.filter((row) => row.direction === "OUTBOUND").length} />
      </div>
      <SectionCard title="Communication Log" description="All entries are scoped to the current organization.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-600">No communications logged yet.</td></tr>
              ) : rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-900">{formatDateTime(row.communicationDate)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(row.communicationType)} / {formatEnumLabel(row.direction)}</td>
                  <td className="px-4 py-3 text-slate-900">
                    <Link href={`/communications/${row.id}`} className="font-semibold text-emerald-700 hover:underline">
                      {formatText(row.subject, "No subject")}
                    </Link>
                    {row.campaign ? <p className="text-xs text-slate-700">Campaign: {row.campaign.name}</p> : null}
                    {row.event ? <p className="text-xs text-slate-700">Event: {row.event.title}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-900">{row.member ? formatPersonName(row.member) : "No member"}</td>
                  <td className="px-4 py-3 text-slate-900">{row.followUpRequired ? formatDateTime(row.followUpDate, "Required") : "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
