import { requirePermission, roleRank } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { formatDateTime } from "@/lib/formatting";
import { AttendanceSessionManager } from "@/components/app/AttendanceSessionManager";

export default async function MeetingAttendanceSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { can, role } = await requirePermission("attendance:read");
  const { id } = await params;
  const meeting = await prisma.meeting.findFirst({ where: { id } });

  if (!meeting) {
    return (
      <main className="space-y-6">
        <PageHeader title="Meeting not found" description="The requested meeting is unavailable." actions={[{ href: "/meetings", label: "Back to Meetings" }]} />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title={`${meeting.title} — QR Attendance`}
        description={`Scheduled for ${formatDateTime(meeting.meetingDate)}. Open attendance to display a scannable check-in code.`}
        actions={[
          { href: `/meetings/${meeting.id}`, label: "Back to Meeting" },
          { href: `/meetings/${meeting.id}/attendance`, label: "Bulk Entry Worksheet" },
        ]}
      />
      <SectionCard title="Attendance Session" description="Configure the check-in window, then open attendance to start accepting scans.">
        <AttendanceSessionManager
          meetingId={meeting.id}
          canWrite={can("attendance:write")}
          canReopen={roleRank(role) >= roleRank("ORG_ADMIN")}
        />
      </SectionCard>
    </main>
  );
}
