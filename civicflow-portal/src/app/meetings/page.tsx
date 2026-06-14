import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDateTime, formatText } from "@/lib/formatting";

export default async function MeetingsPage() {
  const { organizationId } = await requirePermission("meetings:read");
  const rows = await prisma.meeting.findMany({
    where: { organizationId },
    orderBy: [{ meetingDate: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { attendanceRecords: true } } },
    take: 100,
  });
  const now = new Date();
  return (
    <main className="space-y-6">
      <PageHeader title="Meetings" description="Create meetings and manage bulk attendance." actions={[{ href: "/meetings/new", label: "New Meeting", tone: "primary" }, { href: "/dashboard", label: "Back to Dashboard" }]} />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Meetings" value={rows.length} />
        <StatCard label="Upcoming" value={rows.filter((row) => row.meetingDate >= now).length} />
        <StatCard label="Attendance Records" value={rows.reduce((sum, row) => sum + row._count.attendanceRecords, 0)} />
      </div>
      <SectionCard title="Meeting List" description="Open a meeting to review details or manage attendance.">
        <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Meeting</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Attendance</th></tr></thead><tbody>
          {rows.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-600">No meetings created yet.</td></tr> : rows.map((row) => (
            <tr key={row.id} className="border-t border-slate-100"><td className="px-4 py-3 text-slate-900">{formatDateTime(row.meetingDate)}</td><td className="px-4 py-3"><Link href={`/meetings/${row.id}`} className="font-semibold text-emerald-700 hover:underline">{row.title}</Link><p className="text-xs text-slate-700">{formatText(row.meetingType, "")}</p></td><td className="px-4 py-3 text-slate-900">{formatText(row.location, "No location")}</td><td className="px-4 py-3 text-slate-900"><Link href={`/meetings/${row.id}/attendance`} className="text-emerald-700 hover:underline">{row._count.attendanceRecords} records</Link></td></tr>
          ))}
        </tbody></table></div>
      </SectionCard>
    </main>
  );
}

