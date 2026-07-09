import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { formatCurrency, formatDate, formatDateTime, formatEnumLabel } from "@/lib/formatting";
import { getUserOrgMemberships } from "@/lib/org-context";
import { prisma } from "@/lib/prisma";

function OrgBadge({ name }: { name: string }) {
  return (
    <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      {name}
    </span>
  );
}

export default async function AllOrganizationsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="dues" title="All Organizations" />
      </div>
    );
  }

  const memberships = (await getUserOrgMemberships(session.userId)).filter(
    (m): m is typeof m & { memberId: string } => m.role === "MEMBER" && Boolean(m.memberId)
  );

  // Nothing to consolidate for a single-org member — send them to the
  // regular per-org dues view instead of an empty cross-org page.
  if (memberships.length < 2) {
    redirect("/m/dues");
  }

  const orgs = memberships.map((m) => ({
    organizationId: m.organizationId,
    organizationName: m.organizationName,
    memberId: m.memberId,
  }));
  const now = new Date();

  const [eventsByOrg, duesByOrg, announcementsByOrg, attendanceByOrg] = await Promise.all([
    Promise.all(
      orgs.map((o) =>
        prisma.event
          .findMany({
            where: { organizationId: o.organizationId, OR: [{ endAt: { gte: now } }, { startAt: { gte: now } }] },
            orderBy: { startAt: "asc" },
            take: 10,
          })
          .then((rows) => rows.map((row) => ({ ...row, organizationName: o.organizationName })))
      )
    ),
    Promise.all(
      orgs.map((o) =>
        prisma.duesCharge
          .aggregate({
            where: { organizationId: o.organizationId, memberId: o.memberId, status: { in: ["PENDING", "PARTIAL"] } },
            _sum: { amountDue: true, amountPaid: true },
          })
          .then((agg) => ({
            organizationId: o.organizationId,
            organizationName: o.organizationName,
            outstanding: Math.max(0, Number(agg._sum.amountDue ?? 0) - Number(agg._sum.amountPaid ?? 0)),
          }))
      )
    ),
    Promise.all(
      orgs.map((o) =>
        prisma.communicationRecipient
          .findMany({
            where: {
              organizationId: o.organizationId,
              memberId: o.memberId,
              deliveryStatus: { in: ["SENT", "SKIPPED"] },
              campaign: { communicationType: { in: ["ANNOUNCEMENT", "GENERAL"] }, status: "SENT" },
            },
            orderBy: { sentAt: "desc" },
            include: { campaign: { select: { id: true, subject: true, title: true, body: true, sentAt: true } } },
            take: 5,
          })
          .then((rows) => rows.map((row) => ({ ...row, organizationName: o.organizationName })))
      )
    ),
    Promise.all(
      orgs.map((o) =>
        prisma.attendanceRecord
          .findMany({
            where: { organizationId: o.organizationId, memberId: o.memberId, meetingDate: { gte: now } },
            orderBy: { meetingDate: "asc" },
            include: { event: { select: { title: true } }, meeting: { select: { title: true } } },
            take: 10,
          })
          .then((rows) => rows.map((row) => ({ ...row, organizationName: o.organizationName })))
      )
    ),
  ]);

  const events = eventsByOrg.flat().sort((a, b) => (a.startAt?.getTime() ?? 0) - (b.startAt?.getTime() ?? 0));
  const duesOutstanding = duesByOrg.filter((d) => d.outstanding > 0);
  const announcements = announcementsByOrg
    .flat()
    .sort((a, b) => (b.campaign.sentAt?.getTime() ?? 0) - (a.campaign.sentAt?.getTime() ?? 0));
  const assignments = attendanceByOrg.flat();

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">All Organizations</h1>
        <p className="mt-1 text-sm text-slate-600">A combined view across every organization where you&apos;re a member.</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Outstanding Dues</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {duesOutstanding.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-600">No outstanding dues across your organizations.</p>
          ) : (
            duesOutstanding.map((d) => (
              <div key={d.organizationId} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <OrgBadge name={d.organizationName} />
                  <p className="mt-1 font-semibold text-slate-900">{formatCurrency(d.outstanding)}</p>
                </div>
                <Link href={`/m/dues?org=${d.organizationId}`} className="text-sm font-medium text-emerald-700 hover:underline">
                  View →
                </Link>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Upcoming Events</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {events.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-600">No upcoming events.</p>
          ) : (
            events.map((event) => (
              <div key={event.id} className="px-4 py-3 text-sm">
                <OrgBadge name={event.organizationName} />
                <p className="mt-1 font-semibold text-slate-900">{event.title}</p>
                <p className="text-slate-600">
                  {event.startAt ? formatDateTime(event.startAt) : "Date TBD"}
                  {event.location ? ` · ${event.location}` : ""}
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Announcements</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {announcements.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-600">No announcements yet.</p>
          ) : (
            announcements.map((recipient) => (
              <div key={`${recipient.organizationName}-${recipient.campaign.id}`} className="px-4 py-3 text-sm">
                <OrgBadge name={recipient.organizationName} />
                <p className="mt-1 font-semibold text-slate-900">{recipient.campaign.subject || recipient.campaign.title}</p>
                {recipient.campaign.sentAt ? (
                  <p className="text-xs text-slate-500">{formatDateTime(recipient.campaign.sentAt)}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Volunteer Assignments</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {assignments.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-600">No upcoming volunteer assignments.</p>
          ) : (
            assignments.map((record) => (
              <div key={record.id} className="px-4 py-3 text-sm">
                <OrgBadge name={record.organizationName} />
                <p className="mt-1 font-semibold text-slate-900">
                  {record.event?.title ?? record.meeting?.title ?? record.meetingTitle ?? "Assignment"}
                </p>
                <p className="text-slate-600">
                  {formatDate(record.meetingDate)} · {formatEnumLabel(record.attendanceStatus)}
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
