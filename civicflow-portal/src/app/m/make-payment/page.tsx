import Link from "next/link";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { formatCurrency, formatDate } from "@/lib/formatting";
import { getMemberWebSession } from "@/lib/member-web-session";
import { prisma } from "@/lib/prisma";

export default async function MemberMakePaymentPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="make-payment" title="Make a Payment" />
      </div>
    );
  }

  const orgSuffix = org ? `?org=${encodeURIComponent(org)}` : "";

  const [campaigns, events] = await Promise.all([
    prisma.campaign.findMany({
      where: { organizationId: memberSession.organizationId, status: "active" },
      orderBy: { endDate: "asc" },
      take: 25,
    }),
    prisma.event.findMany({
      where: {
        organizationId: memberSession.organizationId,
        OR: [{ endAt: { gte: new Date() } }, { startAt: { gte: new Date() } }],
      },
      orderBy: { startAt: "asc" },
      take: 25,
    }),
  ]);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-900">Make a Payment</h1>
      <p className="text-sm text-slate-600">Choose what you&apos;d like to pay for.</p>

      <Link
        href={`/m/make-payment/dues${orgSuffix}`}
        className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-emerald-300"
      >
        <p className="font-semibold text-slate-900">Membership Dues</p>
        <p className="mt-1 text-sm text-slate-600">Pay ahead on your dues, in any amount.</p>
      </Link>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Campaigns</h2>
        {campaigns.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">
            No active campaigns right now.
          </p>
        ) : (
          campaigns.map((campaign) => (
            <Link
              key={campaign.id}
              href={`/m/make-payment/campaign/${campaign.id}${orgSuffix}`}
              className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-emerald-300"
            >
              <p className="font-semibold text-slate-900">{campaign.name}</p>
              {campaign.goal ? <p className="mt-1 text-sm text-slate-600">Goal: {formatCurrency(campaign.goal)}</p> : null}
              {campaign.endDate ? <p className="text-xs text-slate-500">Ends {formatDate(campaign.endDate)}</p> : null}
            </Link>
          ))
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Events</h2>
        {events.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">
            No upcoming events right now.
          </p>
        ) : (
          events.map((event) => (
            <Link
              key={event.id}
              href={`/m/make-payment/event/${event.id}${orgSuffix}`}
              className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-emerald-300"
            >
              <p className="font-semibold text-slate-900">{event.title}</p>
              <p className="mt-1 text-xs text-slate-500">
                {event.startAt ? formatDate(event.startAt) : "Date TBD"}
                {event.location ? ` · ${event.location}` : ""}
              </p>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
