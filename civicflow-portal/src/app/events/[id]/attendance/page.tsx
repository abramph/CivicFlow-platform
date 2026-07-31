import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDateTime, formatEnumLabel, formatPersonName } from "@/lib/formatting";

export default async function EventAttendancePage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requirePermission("attendance:read");
  const { id } = await params;
  const [event, rows] = await Promise.all([
    prisma.event.findFirst({ where: { id, organizationId } }),
    prisma.attendanceRecord.findMany({
      where: { organizationId, eventId: id },
      orderBy: [{ meetingDate: "desc" }, { createdAt: "desc" }],
      include: { member: true },
      take: 200,
    }),
  ]);

  if (!event) {
    return <main className="space-y-6"><PageHeader title="Event not found" description="The requested event is unavailable." actions={[{ href: "/events", label: "Back to Events" }]} /></main>;
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title={`${event.title} Attendance`}
        description="Attendance recorded for this event."
        actions={[
          { href: `/events/${event.id}/attendance-session`, label: "QR Check-In Session", tone: "primary" },
          { href: `/attendance/new?eventId=${event.id}`, label: "Record Attendance" },
          { href: `/events/${event.id}`, label: "Back to Event" },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Records" value={rows.length} />
        <StatCard label="Present / Virtual" value={rows.filter((row) => ["PRESENT", "VIRTUAL"].includes(row.attendanceStatus)).length} />
        <StatCard label="Event Start" value={formatDateTime(event.startAt)} />
      </div>
      <SectionCard title="Event Attendance" description="Members recorded against this event.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Member</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Record</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-600">No attendance for this event.</td></tr> : rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-900">{formatDateTime(row.meetingDate)}</td>
                  <td className="px-4 py-3 text-slate-900"><Link href={`/members/${row.member.id}`} className="font-semibold text-emerald-700 hover:underline">{formatPersonName(row.member)}</Link></td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(row.attendanceStatus)}</td>
                  <td className="px-4 py-3 text-slate-900"><Link href={`/attendance/${row.id}`} className="text-emerald-700 hover:underline">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}

