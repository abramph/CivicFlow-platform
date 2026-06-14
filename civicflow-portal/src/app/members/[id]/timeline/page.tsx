import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { ManualTimelineEventForm } from "@/components/forms/ManualTimelineEventForm";
import { formatDateTime, formatEnumLabel, formatPersonName } from "@/lib/formatting";

export default async function MemberTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requirePermission("members:read");
  const { id } = await params;
  const [member, rows] = await Promise.all([
    prisma.orgMember.findFirst({ where: { id, organizationId } }),
    prisma.memberTimelineEvent.findMany({ where: { organizationId, memberId: id }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], take: 200 }),
  ]);
  if (!member) return <main className="space-y-6"><PageHeader title="Member not found" description="The requested member is unavailable." actions={[{ href: "/members", label: "Back to Members" }]} /></main>;
  return (
    <main className="space-y-6">
      <PageHeader title={`${formatPersonName(member)} Timeline`} description="Member transitions, payments, communications, attendance, and manual notes." actions={[{ href: `/members/${member.id}`, label: "Back to Member" }, { href: "/members", label: "Back to Members" }]} />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Timeline Events" value={rows.length} />
        <StatCard label="Latest Event" value={formatDateTime(rows[0]?.occurredAt)} />
        <StatCard label="Manual Notes" value={rows.filter((row) => row.eventType === "MANUAL").length} />
      </div>
      <SectionCard title="Add Manual Note" description="Manual timeline notes are audited and scoped to this member.">
        <ManualTimelineEventForm memberId={member.id} />
      </SectionCard>
      <SectionCard title="Timeline" description="Most recent member history first.">
        <div className="space-y-3">
          {rows.length === 0 ? <p className="text-sm text-slate-600">No timeline events yet.</p> : rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-950">{row.title}</p>
              <p className="mt-1 text-xs text-slate-700">{formatEnumLabel(row.eventType)} · {formatDateTime(row.occurredAt)}</p>
              {row.description ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{row.description}</p> : null}
            </div>
          ))}
        </div>
      </SectionCard>
    </main>
  );
}

