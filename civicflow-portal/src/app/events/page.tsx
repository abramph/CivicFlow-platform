import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDateTime, formatText } from "@/lib/formatting";
import { EVENT_STATUS_LABELS, isActiveEventStatus, normalizeEventStatus } from "@/lib/event-status";
import { getEmptyStateCopy } from "@/lib/vertical-terminology";

export default async function EventsPage() {
  const { organizationId, session } = await requirePermission("events:read");

  const events = await prisma.event.findMany({
    where: { organizationId },
    orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
    take: 100,
    include: {
      _count: {
        select: {
          contributions: true,
        },
      },
    },
  });

  const contributionTotals = events.length
    ? await prisma.contribution.groupBy({
        by: ["eventId"],
        where: {
          organizationId,
          eventId: {
            in: events.map((event) => event.id),
          },
        },
        _sum: { amount: true },
        _count: { id: true },
      })
    : [];

  const totalsByEventId = new Map(
    contributionTotals.map((row) => [
      row.eventId ?? "",
      {
        amount: Number(row._sum.amount ?? 0),
        count: row._count.id,
      },
    ])
  );

  return (
    <main className="space-y-6">
      <PageHeader
        title="Events"
        description="Event records and revenue activity scoped to the authenticated organization."
        actions={[
          { href: "/events/new", label: "New Event", tone: "primary" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Events" value={events.length} />
        <StatCard
          label="Upcoming / Active"
          value={events.filter((event) => isActiveEventStatus(event.status)).length}
        />
        <StatCard
          label="Event Contributions"
          value={formatCurrency(
            contributionTotals.reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0)
          )}
        />
      </div>

      <SectionCard title="Event List" description="Events include schedule, location, and revenue tied to each event.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Schedule</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Raised</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-600">
                    {getEmptyStateCopy(session.primaryVertical ?? "COMMUNITY", "events")}
                  </td>
                </tr>
              ) : (
                events.map((event) => {
                  const totals = totalsByEventId.get(event.id);
                  return (
                    <tr key={event.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 text-slate-950">
                        <Link href={`/events/${event.id}`} className="font-semibold text-emerald-700 hover:underline">
                          {event.title}
                        </Link>
                        {event.description ? (
                          <p className="mt-1 max-w-md text-xs leading-5 text-slate-700">{event.description}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-900">{EVENT_STATUS_LABELS[normalizeEventStatus(event.status)]}</td>
                      <td className="px-4 py-3 text-slate-900">
                        {formatDateTime(event.startAt)} to {formatDateTime(event.endAt)}
                      </td>
                      <td className="px-4 py-3 text-slate-900">{formatText(event.location, "TBD")}</td>
                      <td className="px-4 py-3 text-slate-900">
                        {formatCurrency(totals?.amount ?? 0)}
                        <p className="text-xs text-slate-700">{totals?.count ?? 0} contributions</p>
                      </td>
                      <td className="px-4 py-3 text-slate-900">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/events/${event.id}`}
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium hover:bg-slate-50"
                          >
                            View
                          </Link>
                          <Link
                            href={`/events/${event.id}/edit`}
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium hover:bg-slate-50"
                          >
                            Edit
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
