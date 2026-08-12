import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { AttachmentManager } from "@/components/forms/AttachmentManager";
import { MeetingMinutesPanel } from "@/components/forms/MeetingMinutesPanel";
import { formatDateTime, formatEnumLabel, formatText } from "@/lib/formatting";
import { getOrganizationLabAccess } from "@/lib/labs/access";
import { getMeetingMinutesVersions } from "@/lib/meeting-minutes";
import { getRsvpMode } from "@/lib/event-rsvp";

export default async function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId, can } = await requirePermission("meetings:read");
  const { id } = await params;
  const meeting = await prisma.meeting.findFirst({
    where: { id, organizationId },
    include: { attendanceRecords: { include: { member: true }, orderBy: { attendanceStatus: "asc" } } },
  });
  if (!meeting) return <main className="space-y-6"><PageHeader title="Meeting not found" description="The requested meeting is unavailable." actions={[{ href: "/meetings", label: "Back to Meetings" }]} /></main>;

  // Core Meeting RSVP — intent, shown alongside (never mixed into) recorded
  // attendance. Which view renders is capability-driven: PTA sees household
  // RSVPs (one row can represent several attendees, so the headline metric
  // sums attendeeCount), Community/Union see per-member RSVPs (one GOING row
  // = one expected attendee), HOA is RSVP mode "none" this phase.
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { primaryVertical: true } });
  const rsvpMode = organization ? getRsvpMode(organization.primaryVertical) : "none";
  const memberRsvps =
    rsvpMode === "individual"
      ? await prisma.meetingRsvp.findMany({
          where: { organizationId, meetingId: meeting.id },
          include: { orgMember: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { updatedAt: "desc" },
        })
      : [];
  const householdRsvps =
    rsvpMode === "household"
      ? await prisma.ptaMeetingRsvp.findMany({
          where: { organizationId, meetingId: meeting.id },
          include: { household: { select: { id: true, displayName: true } } },
          orderBy: { updatedAt: "desc" },
        })
      : [];
  const expectedAttendees =
    rsvpMode === "individual"
      ? memberRsvps.filter((r) => r.status === "GOING").length
      : householdRsvps.filter((r) => r.status === "GOING").reduce((sum, r) => sum + r.attendeeCount, 0);

  // Meeting Intelligence action only appears when all four layers agree:
  // feature exists + org entitled + org enrolled (getOrganizationLabAccess)
  // + user has tenant permission (can(...)) — the backend independently
  // re-enforces every one of these itself; this is UI convenience only.
  const labsAccess = await getOrganizationLabAccess(organizationId, "meetingIntelligence");
  const showMeetingIntelligence = labsAccess.available && can("meetingIntelligence:create");

  const minutesVersions = await getMeetingMinutesVersions({ organizationId, meetingId: meeting.id });

  const actions = [
    { href: `/meetings/${meeting.id}/attendance-session`, label: "QR Attendance", tone: "primary" as const },
    { href: `/meetings/${meeting.id}/attendance`, label: "Bulk Entry Worksheet" },
    ...(showMeetingIntelligence ? [{ href: `/labs/meeting-intelligence/meetings/${meeting.id}`, label: "Generate Minutes from Recording" }] : []),
    { href: "/meetings", label: "Back to Meetings" },
    { href: "/dashboard", label: "Back to Dashboard" },
  ];

  return (
    <main className="space-y-6">
      <PageHeader title={meeting.title} description="Meeting details and attendance summary." actions={actions} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Date" value={formatDateTime(meeting.meetingDate)} />
        <StatCard label="Type" value={formatText(meeting.meetingType, "Not set")} />
        <StatCard label="Location" value={formatText(meeting.location, "No location")} />
        <StatCard label="Attendance" value={meeting.attendanceRecords.length} />
        {rsvpMode !== "none" ? (
          <StatCard
            label="Expected Attendees"
            value={expectedAttendees}
            helper={
              rsvpMode === "household"
                ? `${householdRsvps.filter((r) => r.status === "GOING").length} household(s) going · ${householdRsvps.length} response(s)`
                : `${memberRsvps.filter((r) => r.status === "GOING").length} member(s) going · ${memberRsvps.length} response(s)`
            }
          />
        ) : null}
      </div>
      {rsvpMode === "individual" ? (
        <SectionCard title="Member RSVPs" description="Individual RSVP responses for this meeting. Each 'Going' response represents one expected attendee. RSVPs are intent — recorded attendance below remains the factual record.">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr><th className="px-4 py-3">Member</th><th className="px-4 py-3">Response</th><th className="px-4 py-3">Updated</th></tr>
              </thead>
              <tbody>
                {memberRsvps.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-600">No members have responded to this meeting yet.</td></tr>
                ) : memberRsvps.map((rsvp) => (
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
      {rsvpMode === "household" ? (
        <SectionCard title="Household RSVPs" description="Household RSVP responses for this meeting. One household response can represent several attendees — the Expected Attendees figure sums household counts, not rows.">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr><th className="px-4 py-3">Household</th><th className="px-4 py-3">Attendees</th><th className="px-4 py-3">Response</th><th className="px-4 py-3">Updated</th></tr>
              </thead>
              <tbody>
                {householdRsvps.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-600">No households have responded to this meeting yet.</td></tr>
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
        </SectionCard>
      ) : null}
      <SectionCard title="Attendance Summary" description="Status counts for this meeting.">
        <div className="grid gap-4 md:grid-cols-5">
          {["PRESENT", "ABSENT", "EXCUSED", "LATE", "VIRTUAL"].map((status) => <StatCard key={status} label={formatEnumLabel(status)} value={meeting.attendanceRecords.filter((row) => row.attendanceStatus === status).length} />)}
        </div>
      </SectionCard>
      <SectionCard title="Notes" description="Meeting description and notes.">
        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{formatText(meeting.description, "No description recorded.")}</p>
        {meeting.notes ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-800">{meeting.notes}</p> : null}
      </SectionCard>
      <SectionCard title="Meeting Minutes" description="Draft, review, and approve official minutes for this meeting. Members only ever see the approved version.">
        <MeetingMinutesPanel
          meetingId={meeting.id}
          versions={minutesVersions.map((v) => ({
            id: v.id,
            version: v.version,
            status: v.status,
            title: v.title,
            bodyText: v.bodyText,
            changesRequestedReason: v.changesRequestedReason,
            approvedAt: v.approvedAt ? v.approvedAt.toISOString() : null,
          }))}
          canWrite={can("meetings:write")}
          canReview={can("meetings:minutes:review")}
          canApprove={can("meetings:minutes:approve")}
        />
      </SectionCard>
      <SectionCard title="Attachments" description="Upload agendas, handouts, and other private meeting documents.">
        <AttachmentManager entityType="MEETING" entityId={meeting.id} purpose="MEETING_ATTACHMENT" canWrite={can("meetings:write")} titleLabel="Document title" />
      </SectionCard>
    </main>
  );
}
