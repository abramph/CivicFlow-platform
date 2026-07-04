import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { formatDateTime } from "@/lib/formatting";
import { getMemberWebSession } from "@/lib/member-web-session";
import { prisma } from "@/lib/prisma";

export default async function MemberEventsPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="events" title="Upcoming Events" />
      </div>
    );
  }

  const events = await prisma.event.findMany({
    where: {
      organizationId: memberSession.organizationId,
      OR: [{ endAt: { gte: new Date() } }, { startAt: { gte: new Date() } }],
    },
    orderBy: { startAt: "asc" },
    take: 50,
  });

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">Upcoming Events</h1>
      <div className="space-y-3">
        {events.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">No upcoming events.</p>
        ) : (
          events.map((event) => (
            <div key={event.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="font-semibold text-slate-900">{event.title}</p>
              <p className="text-sm text-slate-600">
                {event.startAt ? formatDateTime(event.startAt) : "Date TBD"}
                {event.location ? ` · ${event.location}` : ""}
              </p>
              {event.description ? <p className="mt-2 text-sm text-slate-800">{event.description}</p> : null}
            </div>
          ))
        )}
      </div>
    </main>
  );
}
