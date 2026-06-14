import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDateTime, formatEnumLabel, formatPersonName, formatText } from "@/lib/formatting";

export default async function MemberAttendancePage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requirePermission("attendance:read");
  const { id } = await params;
  const [member, rows] = await Promise.all([
    prisma.orgMember.findFirst({ where: { id, organizationId } }),
    prisma.attendanceRecord.findMany({
      where: { organizationId, memberId: id },
      orderBy: [{ meetingDate: "desc" }, { createdAt: "desc" }],
      include: { event: true },
      take: 200,
    }),
  ]);

  if (!member) {
    return <main className="space-y-6"><PageHeader title="Member not found" description="The requested member is unavailable." actions={[{ href: "/members", label: "Back to Members" }]} /></main>;
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title={`${formatPersonName(member)} Attendance`}
        description="Attendance history for this member."
        actions={[
          { href: `/attendance/new?memberId=${member.id}`, label: "Record Attendance", tone: "primary" },
          { href: `/members/${member.id}`, label: "Back to Member" },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Records" value={rows.length} />
        <StatCard label="Present / Virtual" value={rows.filter((row) => ["PRESENT", "VIRTUAL"].includes(row.attendanceStatus)).length} />
        <StatCard label="Latest" value={formatDateTime(rows[0]?.meetingDate)} />
      </div>
      <SectionCard title="Attendance History" description="Member-scoped attendance records.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Meeting / Event</th><th className="px-4 py-3">Status</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-600">No attendance records for this member.</td></tr> : rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-900">{formatDateTime(row.meetingDate)}</td>
                  <td className="px-4 py-3 text-slate-900"><Link href={`/attendance/${row.id}`} className="font-semibold text-emerald-700 hover:underline">{row.event?.title ?? formatText(row.meetingTitle, "General meeting")}</Link></td>
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

