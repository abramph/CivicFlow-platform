import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDateTime, formatEnumLabel, formatPersonName, formatText } from "@/lib/formatting";

export default async function AttendanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requirePermission("attendance:read");
  const { id } = await params;
  const row = await prisma.attendanceRecord.findFirst({
    where: { id, organizationId },
    include: { member: true, event: true, recordedBy: true },
  });

  if (!row) {
    return <main className="space-y-6"><PageHeader title="Attendance record not found" description="The requested attendance record is unavailable." actions={[{ href: "/attendance", label: "Back to Attendance" }]} /></main>;
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title="Attendance Detail"
        description="Attendance record with member, meeting, and event context."
        actions={[
          { href: `/members/${row.member.id}`, label: "View Member" },
          ...(row.event ? [{ href: `/events/${row.event.id}/attendance`, label: "Event Attendance" }] : []),
          { href: "/attendance", label: "Back to Attendance" },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Member" value={formatPersonName(row.member)} />
        <StatCard label="Status" value={formatEnumLabel(row.attendanceStatus)} />
        <StatCard label="Meeting Date" value={formatDateTime(row.meetingDate)} />
        <StatCard label="Event" value={row.event?.title ?? formatText(row.meetingTitle, "General meeting")} />
      </div>
      <SectionCard title="Times and Notes" description="Optional check-in, check-out, and notes for this attendance record.">
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard label="Check-in" value={formatDateTime(row.checkInTime)} />
          <StatCard label="Check-out" value={formatDateTime(row.checkOutTime)} />
        </div>
        {row.notes ? <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-medium text-slate-950">Notes</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{row.notes}</p></div> : null}
      </SectionCard>
    </main>
  );
}

