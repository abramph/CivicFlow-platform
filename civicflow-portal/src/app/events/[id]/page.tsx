import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { AttachmentManager } from "@/components/forms/AttachmentManager";
import { CancelEventButton } from "@/components/forms/CancelEventButton";
import { prisma } from "@/lib/prisma";
import { EVENT_STATUS_LABELS, isCancelledEventStatus, normalizeEventStatus } from "@/lib/event-status";
import {
  formatCurrency,
  formatDateTime,
  formatEnumLabel,
  formatText,
} from "@/lib/formatting";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organizationId, can } = await requirePermission("events:read");
  const { id } = await params;

  const [event, contributionSummary, contributions, attendance] = await Promise.all([
    prisma.event.findFirst({
      where: { id, organizationId },
    }),
    prisma.contribution.aggregate({
      where: { organizationId, eventId: id },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.contribution.findMany({
      where: { organizationId, eventId: id },
      orderBy: [{ contributionDate: "desc" }, { createdAt: "desc" }],
      include: {
        member: true,
        campaign: true,
      },
      take: 100,
    }),
    prisma.attendanceRecord.findMany({
      where: { organizationId, eventId: id },
      orderBy: [{ meetingDate: "desc" }, { createdAt: "desc" }],
      include: { member: true },
      take: 20,
    }),
  ]);

  if (!event) {
    return (
      <main className="space-y-6">
        <PageHeader
          title="Event not found"
          description="The requested event does not exist in your organization."
          actions={[
            { href: "/events", label: "Back to Events" },
            { href: "/dashboard", label: "Back to Dashboard" },
          ]}
        />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title={event.title}
        description="Event details and contributions attributed to this event."
        actions={[
          { href: `/events/${event.id}/edit`, label: "Edit Event", tone: "primary" },
          { href: `/contributions/new?eventId=${event.id}`, label: "Record Contribution" },
          { href: `/attendance/new?eventId=${event.id}`, label: "Record Attendance" },
          { href: `/events/${event.id}/attendance`, label: "Attendance" },
          { href: "/events", label: "Back to Events" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Status"
          value={EVENT_STATUS_LABELS[normalizeEventStatus(event.status)]}
          helper={
            !isCancelledEventStatus(event.status) && can("events:write") ? (
              <CancelEventButton eventId={event.id} />
            ) : undefined
          }
        />
        <StatCard label="Start" value={formatDateTime(event.startAt)} />
        <StatCard label="End" value={formatDateTime(event.endAt)} />
        <StatCard
          label="Contributions"
          value={formatCurrency(contributionSummary._sum.amount)}
          helper={`${contributionSummary._count.id} contributions`}
        />
        <StatCard label="Attendance" value={attendance.length} helper={`${attendance.filter((row) => ["PRESENT", "VIRTUAL"].includes(row.attendanceStatus)).length} present / virtual`} />
      </div>

      <SectionCard title="Event Overview" description="Operational details for this event.">
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard label="Location" value={formatText(event.location, "Location not set")} />
          <StatCard label="Event Record" value={event.id} />
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-900">Description</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">
            {formatText(event.description, "No event description has been added yet.")}
          </p>
        </div>
        {event.notes ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-900">Notes</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{event.notes}</p>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Event Attachments" description="Store private event documents, flyers, forms, and supporting files.">
        <AttachmentManager entityType="EVENT" entityId={event.id} canWrite={can("events:write")} />
      </SectionCard>

      <SectionCard title="Event Attendance" description="Recent attendance records tied to this event.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Member</th><th className="px-4 py-3">Status</th></tr>
            </thead>
            <tbody>
              {attendance.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-600">No attendance has been recorded for this event.</td></tr>
              ) : attendance.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-900">{formatDateTime(row.meetingDate)}</td>
                  <td className="px-4 py-3 text-slate-900">{row.member.lastName}, {row.member.firstName}</td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(row.attendanceStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Event Contributions" description="Contributions tied directly to this event.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {contributions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-600">
                    No contributions are linked to this event yet.
                  </td>
                </tr>
              ) : (
                contributions.map((contribution) => (
                  <tr key={contribution.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{formatDateTime(contribution.contributionDate)}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {contribution.member
                        ? `${contribution.member.lastName}, ${contribution.member.firstName}`
                        : (contribution.contributorName || "Non-member")}
                    </td>
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(contribution.source)}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {contribution.campaign ? (
                        <Link href={`/campaigns/${contribution.campaign.id}`} className="text-emerald-700 hover:underline">
                          {contribution.campaign.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-900">{formatCurrency(contribution.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
