import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDateTime, formatEnumLabel, formatPersonName, formatText } from "@/lib/formatting";

export default async function MemberCommunicationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requirePermission("communications:read");
  const { id } = await params;
  const [member, rows] = await Promise.all([
    prisma.orgMember.findFirst({ where: { id, organizationId } }),
    prisma.communicationLog.findMany({
      where: { organizationId, memberId: id },
      orderBy: [{ communicationDate: "desc" }, { createdAt: "desc" }],
      include: { campaign: true, event: true },
      take: 200,
    }),
  ]);

  if (!member) {
    return <main className="space-y-6"><PageHeader title="Member not found" description="The requested member is unavailable." actions={[{ href: "/members", label: "Back to Members" }]} /></main>;
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title={`${formatPersonName(member)} Communications`}
        description="Communication history for this member."
        actions={[
          { href: `/communications/new?memberId=${member.id}`, label: "Log Communication", tone: "primary" },
          { href: `/members/${member.id}`, label: "Back to Member" },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Entries" value={rows.length} />
        <StatCard label="Follow-ups" value={rows.filter((row) => row.followUpRequired).length} />
        <StatCard label="Latest" value={formatDateTime(rows[0]?.communicationDate)} />
      </div>
      <SectionCard title="Communication History" description="Member-scoped communication records.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Subject</th><th className="px-4 py-3">Follow-up</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-600">No communications for this member.</td></tr> : rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-900">{formatDateTime(row.communicationDate)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(row.communicationType)}</td>
                  <td className="px-4 py-3 text-slate-900"><Link href={`/communications/${row.id}`} className="font-semibold text-emerald-700 hover:underline">{formatText(row.subject, "No subject")}</Link></td>
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

