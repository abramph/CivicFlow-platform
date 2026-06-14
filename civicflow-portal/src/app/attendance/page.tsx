import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDateTime, formatEnumLabel, formatPersonName, formatText } from "@/lib/formatting";

export default async function AttendancePage() {
  const { organizationId } = await requirePermission("attendance:read");
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const rows = await prisma.attendanceRecord.findMany({
    where: { organizationId },
    orderBy: [{ meetingDate: "desc" }, { createdAt: "desc" }],
    include: { member: true, event: true },
    take: 150,
  });

  return (
    <main className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Track event and general meeting attendance."
        actions={[
          { href: "/attendance/new", label: "Record Attendance", tone: "primary" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Records" value={rows.length} />
        <StatCard label="This Month" value={rows.filter((row) => row.meetingDate >= monthStart).length} />
        <StatCard label="Present / Virtual" value={rows.filter((row) => ["PRESENT", "VIRTUAL"].includes(row.attendanceStatus)).length} />
      </div>
      <SectionCard title="Attendance Records" description="Event and general meeting attendance are stored as organization-scoped records.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Member</th><th className="px-4 py-3">Meeting / Event</th><th className="px-4 py-3">Status</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-600">No attendance has been recorded yet.</td></tr> : rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-900">{formatDateTime(row.meetingDate)}</td>
                  <td className="px-4 py-3 text-slate-900"><Link href={`/members/${row.member.id}`} className="font-semibold text-emerald-700 hover:underline">{formatPersonName(row.member)}</Link></td>
                  <td className="px-4 py-3 text-slate-900"><Link href={`/attendance/${row.id}`} className="text-emerald-700 hover:underline">{row.event?.title ?? formatText(row.meetingTitle, "General meeting")}</Link></td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(row.attendanceStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}

