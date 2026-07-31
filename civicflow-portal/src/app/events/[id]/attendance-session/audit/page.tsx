import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { formatDateTime } from "@/lib/formatting";

export default async function EventAttendanceAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requirePermission("attendance:read");
  const { id } = await params;
  const event = await prisma.event.findFirst({ where: { id, organizationId } });
  if (!event) {
    return (
      <main className="space-y-6">
        <PageHeader title="Event not found" actions={[{ href: "/events", label: "Back to Events" }]} />
      </main>
    );
  }

  const sessions = await prisma.meetingAttendanceSession.findMany({ where: { organizationId, eventId: id }, select: { id: true } });
  const records = await prisma.attendanceRecord.findMany({ where: { organizationId, eventId: id }, select: { id: true } });
  const resourceIds = [id, ...sessions.map((s) => s.id), ...records.map((r) => r.id)];

  const events = await prisma.auditEvent.findMany({
    where: {
      organizationId,
      resource: { in: ["event", "meeting_attendance_session", "attendance_record", "meeting_attendance"] },
      resourceId: { in: resourceIds },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <main className="space-y-6">
      <PageHeader
        title={`${event.title} — Attendance Audit History`}
        actions={[{ href: `/events/${event.id}/attendance-session`, label: "Back to Attendance" }]}
      />
      <SectionCard title="Audit Trail" description="Every session and attendance-record change, most recent first.">
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Resource</th>
                <th className="px-3 py-2">Actor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="px-3 py-2">{formatDateTime(event.createdAt)}</td>
                  <td className="px-3 py-2">{event.action}</td>
                  <td className="px-3 py-2">{event.resource}</td>
                  <td className="px-3 py-2">{event.actorEmail ?? "—"}</td>
                </tr>
              ))}
              {events.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">No audit history yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
