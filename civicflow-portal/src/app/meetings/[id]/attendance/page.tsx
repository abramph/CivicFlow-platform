import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { BulkMeetingAttendanceForm } from "@/components/forms/BulkMeetingAttendanceForm";
import { formatDateTime } from "@/lib/formatting";

export default async function MeetingAttendancePage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requirePermission("attendance:read");
  const { id } = await params;
  const [meeting, members, attendance] = await Promise.all([
    prisma.meeting.findFirst({ where: { id, organizationId } }),
    prisma.orgMember.findMany({ where: { organizationId, membershipStatus: "active" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true } }),
    prisma.attendanceRecord.findMany({ where: { organizationId, meetingId: id }, select: { memberId: true, attendanceStatus: true } }),
  ]);
  if (!meeting) return <main className="space-y-6"><PageHeader title="Meeting not found" description="The requested meeting is unavailable." actions={[{ href: "/meetings", label: "Back to Meetings" }]} /></main>;
  const statusByMember = new Map(attendance.map((row) => [row.memberId, row.attendanceStatus]));
  return (
    <main className="space-y-6">
      <PageHeader title={`${meeting.title} Attendance`} description="Bulk attendance worksheet for active organization members." actions={[{ href: `/meetings/${meeting.id}`, label: "Back to Meeting" }, { href: "/meetings", label: "Back to Meetings" }]} />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Meeting Date" value={formatDateTime(meeting.meetingDate)} />
        <StatCard label="Active Members" value={members.length} />
        <StatCard label="Saved Records" value={attendance.length} />
      </div>
      <SectionCard title="Bulk Attendance" description="Select members and assign attendance status, then save all selected records.">
        <BulkMeetingAttendanceForm meetingId={meeting.id} members={members.map((member) => ({ ...member, currentStatus: statusByMember.get(member.id) }))} />
      </SectionCard>
    </main>
  );
}

