import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { AttachmentManager } from "@/components/forms/AttachmentManager";
import { formatDateTime, formatEnumLabel, formatText } from "@/lib/formatting";
import { getOrganizationLabAccess } from "@/lib/labs/access";

export default async function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId, can } = await requirePermission("meetings:read");
  const { id } = await params;
  const meeting = await prisma.meeting.findFirst({
    where: { id, organizationId },
    include: { attendanceRecords: { include: { member: true }, orderBy: { attendanceStatus: "asc" } } },
  });
  if (!meeting) return <main className="space-y-6"><PageHeader title="Meeting not found" description="The requested meeting is unavailable." actions={[{ href: "/meetings", label: "Back to Meetings" }]} /></main>;

  // Meeting Intelligence action only appears when all four layers agree:
  // feature exists + org entitled + org enrolled (getOrganizationLabAccess)
  // + user has tenant permission (can(...)) — the backend independently
  // re-enforces every one of these itself; this is UI convenience only.
  const labsAccess = await getOrganizationLabAccess(organizationId, "meetingIntelligence");
  const showMeetingIntelligence = labsAccess.available && can("meetingIntelligence:create");

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
      </div>
      <SectionCard title="Attendance Summary" description="Status counts for this meeting.">
        <div className="grid gap-4 md:grid-cols-5">
          {["PRESENT", "ABSENT", "EXCUSED", "LATE", "VIRTUAL"].map((status) => <StatCard key={status} label={formatEnumLabel(status)} value={meeting.attendanceRecords.filter((row) => row.attendanceStatus === status).length} />)}
        </div>
      </SectionCard>
      <SectionCard title="Notes" description="Meeting description and notes.">
        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{formatText(meeting.description, "No description recorded.")}</p>
        {meeting.notes ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-800">{meeting.notes}</p> : null}
      </SectionCard>
      <SectionCard title="Meeting Minutes and Attachments" description="Upload minutes, agendas, handouts, and other private meeting documents.">
        <AttachmentManager entityType="MEETING" entityId={meeting.id} purpose="MEETING_MINUTES" canWrite={can("meetings:write")} titleLabel="Document title" />
      </SectionCard>
    </main>
  );
}
