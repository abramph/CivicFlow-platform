import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { listPtaEventRsvps, getPtaEventAttendanceSummary } from "@/lib/labs/pta/events";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { Breadcrumbs, StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { formatDateTime } from "@/lib/formatting";

const RSVP_TONE: Record<string, string> = { GOING: "healthy", MAYBE: "warning", NOT_GOING: "unknown" };

export default async function PtaEventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { organizationId, access } = await getPtaPageGate("pta:events:manage");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Event" description="Not available for this organization." />
      </main>
    );
  }

  const event = await prisma.event.findFirst({ where: { id: eventId, organizationId }, select: { id: true, title: true, startAt: true, location: true } });
  if (!event) {
    return (
      <main className="space-y-6">
        <PageHeader title="Event not found" />
      </main>
    );
  }

  const [rsvps, summary] = await Promise.all([listPtaEventRsvps(organizationId, eventId), getPtaEventAttendanceSummary(organizationId, eventId)]);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <Breadcrumbs items={[{ href: "/labs/pta/events", label: "Events" }, { label: event.title }]} />
      <PageHeader title={event.title} description={event.startAt ? `${formatDateTime(event.startAt)}${event.location ? ` · ${event.location}` : ""}` : undefined} />

      <SectionCard title="RSVP summary">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Households going" value={summary.householdsGoing} helper={`${summary.totalAttendees} attendee(s) total`} />
          <StatCard label="Maybe" value={summary.householdsMaybe} />
          <StatCard label="Not going" value={summary.householdsNotGoing} />
        </div>
      </SectionCard>

      <SectionCard title="Household RSVPs" description={`${rsvps.length} household(s) have responded.`}>
        {rsvps.length === 0 ? (
          <EmptyState title="No RSVPs yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rsvps.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium text-slate-900">{r.household.displayName}</span>
                <span className="flex items-center gap-2">
                  <span className="text-slate-600">{r.attendeeCount} attendee(s)</span>
                  <StatusPill status={RSVP_TONE[r.status] ?? "unknown"} label={r.status.replace("_", " ")} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </main>
  );
}
