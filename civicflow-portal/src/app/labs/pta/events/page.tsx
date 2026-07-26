import Link from "next/link";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { formatDateTime } from "@/lib/formatting";

/**
 * Events themselves are the existing, unmodified base-platform Event model —
 * created/edited/published from the base Events feature, not rebuilt here
 * (see events.ts's own doc comment on why PTA only adds household-level RSVP
 * tracking, not a second event concept). This page is a PTA-scoped read view
 * that links each event to its RSVP summary.
 */
export default async function PtaEventsPage() {
  const { organizationId, access } = await getPtaPageGate("pta:events:manage");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Events" description="Not available for this organization." />
      </main>
    );
  }

  const events = await prisma.event.findMany({
    where: { organizationId },
    orderBy: { startAt: "desc" },
    take: 25,
    select: { id: true, title: true, startAt: true, location: true, status: true, _count: { select: { ptaVolunteerOpportunities: true } } },
  });

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Events"
        description="Events are created and edited in the base Events feature — this page adds PTA household-level RSVP tracking on top of them."
        actions={[{ href: "/events", label: "Create or edit events" }]}
      />

      <SectionCard title="Recent &amp; upcoming events" description={`${events.length} event(s).`}>
        {events.length === 0 ? (
          <EmptyState title="No events yet" description="Create one from the base Events feature, then come back here to see RSVPs." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <Link href={`/labs/pta/events/${e.id}`} className="font-semibold text-emerald-700 hover:underline">
                    {e.title}
                  </Link>
                  <p className="text-slate-600">
                    {e.startAt ? formatDateTime(e.startAt) : "No date set"}
                    {e.location ? ` · ${e.location}` : ""}
                  </p>
                </div>
                {e._count.ptaVolunteerOpportunities > 0 ? (
                  <span className="text-xs text-slate-500">{e._count.ptaVolunteerOpportunities} volunteer opportunity(ies)</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </main>
  );
}
