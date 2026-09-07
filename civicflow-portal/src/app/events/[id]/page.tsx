import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { AttachmentManager } from "@/components/forms/AttachmentManager";
import { CancelEventButton } from "@/components/forms/CancelEventButton";
import { prisma } from "@/lib/prisma";
import { getRsvpMode } from "@/lib/event-rsvp";
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

  const [event, contributionSummary, contributions, attendance, volunteerOpportunities, organization] = await Promise.all([
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
    // Only ever non-empty for a PTA-vertical org — volunteer opportunities can
    // only be linked to an event through the PTA-gated opportunity API (see
    // requirePtaAccess in that route), so this needs no separate vertical
    // check here.
    prisma.ptaVolunteerOpportunity.findMany({
      where: { organizationId, eventId: id },
      select: { id: true, title: true, status: true, slots: { select: { capacity: true, signups: { where: { status: { in: ["SIGNED_UP", "WAITLISTED"] } }, select: { id: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { primaryVertical: true } }),
  ]);

  // Individual (per-member) RSVPs — Community/Union/Church. HOA is RSVP
  // mode "none". PTA (household mode) is rendered inline below exactly like
  // the meetings page renders PtaMeetingRsvp — one household row can
  // represent several attendees, so its headline sums attendeeCount and is
  // deliberately never mixed with the row-per-member counts.
  const rsvpMode = organization ? getRsvpMode(organization.primaryVertical) : "none";
  const eventRsvps =
    rsvpMode === "individual"
      ? await prisma.eventRsvp.findMany({
          where: { organizationId, eventId: id },
          include: { orgMember: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { updatedAt: "desc" },
        })
      : [];
  const rsvpGoingCount = eventRsvps.filter((r) => r.status === "GOING").length;
  const householdRsvps =
    rsvpMode === "household"
      ? await prisma.ptaEventRsvp.findMany({
          where: { organizationId, eventId: id },
          include: { household: { select: { id: true, displayName: true } } },
          orderBy: { updatedAt: "desc" },
        })
      : [];
  const householdExpectedAttendees = householdRsvps
    .filter((r) => r.status === "GOING")
    .reduce((sum, r) => sum + r.attendeeCount, 0);

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
        {rsvpMode === "individual" ? (
          // For individual RSVP one GOING row is exactly one expected
          // attendee, so this count IS the attendee aggregate (PTA household
          // RSVPs instead sum attendeeCount — see labs/pta/events.ts).
          <StatCard label="RSVPs" value={rsvpGoingCount} helper={`${rsvpGoingCount} expected attendee${rsvpGoingCount === 1 ? "" : "s"} · ${eventRsvps.length} response${eventRsvps.length === 1 ? "" : "s"}`} />
        ) : null}
        {rsvpMode === "household" ? (
          <StatCard
            label="Expected Attendees"
            value={householdExpectedAttendees}
            helper={`${householdRsvps.filter((r) => r.status === "GOING").length} household(s) going · ${householdRsvps.length} response(s)`}
          />
        ) : null}
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

      {volunteerOpportunities.length > 0 ? (
        <SectionCard title="Linked Volunteer Opportunities" description="Volunteer opportunities tied to this event.">
          <ul className="divide-y divide-slate-100">
            {volunteerOpportunities.map((opp) => {
              const capacity = opp.slots.reduce((s, slot) => s + slot.capacity, 0);
              const confirmed = opp.slots.reduce((s, slot) => s + slot.signups.length, 0);
              return (
                <li key={opp.id} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/labs/pta/volunteers/manage/${opp.id}`} className="font-medium text-emerald-700 hover:underline">
                    {opp.title}
                  </Link>
                  <span className="text-slate-600">{formatEnumLabel(opp.status)} · {confirmed}/{capacity} filled</span>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      ) : null}

      {rsvpMode === "household" ? (
        <SectionCard
          title="Household RSVPs"
          description="Household RSVP responses for this event. One household response can represent several attendees — the Expected Attendees figure sums household counts, not rows. The PTA officer event page offers the full RSVP management view."
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr><th className="px-4 py-3">Household</th><th className="px-4 py-3">Attendees</th><th className="px-4 py-3">Response</th><th className="px-4 py-3">Updated</th></tr>
              </thead>
              <tbody>
                {householdRsvps.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-600">No households have responded to this event yet.</td></tr>
                ) : householdRsvps.map((rsvp) => (
                  <tr key={rsvp.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{rsvp.household.displayName}</td>
                    <td className="px-4 py-3 text-slate-900">{rsvp.attendeeCount}</td>
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(rsvp.status)}</td>
                    <td className="px-4 py-3 text-slate-900">{formatDateTime(rsvp.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm">
            <Link href={`/labs/pta/events/${event.id}`} className="text-emerald-700 hover:underline">
              Open the PTA officer view for this event
            </Link>
          </p>
        </SectionCard>
      ) : null}

      {rsvpMode === "individual" ? (
        <SectionCard title="Member RSVPs" description="Individual RSVP responses from members for this event. Each 'Going' response represents one expected attendee.">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr><th className="px-4 py-3">Member</th><th className="px-4 py-3">Response</th><th className="px-4 py-3">Updated</th></tr>
              </thead>
              <tbody>
                {eventRsvps.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-600">No members have responded to this event yet.</td></tr>
                ) : eventRsvps.map((rsvp) => (
                  <tr key={rsvp.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">
                      <Link href={`/members/${rsvp.orgMember.id}`} className="text-emerald-700 hover:underline">
                        {rsvp.orgMember.lastName}, {rsvp.orgMember.firstName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-900">{formatEnumLabel(rsvp.status)}</td>
                    <td className="px-4 py-3 text-slate-900">{formatDateTime(rsvp.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

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
