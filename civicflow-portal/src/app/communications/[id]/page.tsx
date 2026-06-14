import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDateTime, formatEnumLabel, formatPersonName, formatText } from "@/lib/formatting";

export default async function CommunicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requirePermission("communications:read");
  const { id } = await params;
  const row = await prisma.communicationLog.findFirst({
    where: { id, organizationId },
    include: { member: true, campaign: true, event: true, createdBy: true },
  });

  if (!row) {
    return (
      <main className="space-y-6">
        <PageHeader title="Communication not found" description="The requested communication log entry is unavailable." actions={[{ href: "/communications", label: "Back to Communications" }]} />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title={formatText(row.subject, "Communication Detail")}
        description="Communication log detail with attribution and follow-up state."
        actions={[
          ...(row.member ? [{ href: `/members/${row.member.id}`, label: "View Member" }] : []),
          { href: "/communications", label: "Back to Communications" },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Type" value={formatEnumLabel(row.communicationType)} />
        <StatCard label="Direction" value={formatEnumLabel(row.direction)} />
        <StatCard label="Date" value={formatDateTime(row.communicationDate)} />
        <StatCard label="Follow-up" value={row.followUpRequired ? formatDateTime(row.followUpDate, "Required") : "None"} />
      </div>
      <SectionCard title="Context" description="Linked records remain scoped to the current organization.">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Member" value={row.member ? formatPersonName(row.member) : "No member"} />
          <StatCard label="Campaign" value={row.campaign?.name ?? "No campaign"} />
          <StatCard label="Event" value={row.event?.title ?? "No event"} />
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-950">Message</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{formatText(row.message, "No message recorded")}</p>
        </div>
        {row.outcome ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-950">Outcome</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{row.outcome}</p>
          </div>
        ) : null}
        {row.member ? (
          <div className="mt-4">
            <Link href={`/members/${row.member.id}/communications`} className="text-sm font-semibold text-emerald-700 hover:underline">View all member communications</Link>
          </div>
        ) : null}
      </SectionCard>
    </main>
  );
}

