import { requirePermission, roleRank } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { formatDateTime } from "@/lib/formatting";
import { AttendanceSessionManager } from "@/components/app/AttendanceSessionManager";

export default async function EventAttendanceSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { can, role, organizationId } = await requirePermission("attendance:read");
  const { id } = await params;
  const event = await prisma.event.findFirst({ where: { id, organizationId } });

  if (!event) {
    return (
      <main className="space-y-6">
        <PageHeader title="Event not found" description="The requested event is unavailable." actions={[{ href: "/events", label: "Back to Events" }]} />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title={`${event.title} — QR Attendance`}
        description={
          event.startAt
            ? `Scheduled for ${formatDateTime(event.startAt)}. Open attendance to display a scannable check-in code.`
            : "This event has no scheduled start time yet — set one before starting QR attendance."
        }
        actions={[
          { href: `/events/${event.id}`, label: "Back to Event" },
          { href: `/events/${event.id}/attendance`, label: "Attendance Records" },
        ]}
      />
      <SectionCard title="Attendance Session" description="Configure the check-in window, then open attendance to start accepting scans.">
        <AttendanceSessionManager
          entity={{ type: "event", id: event.id }}
          canWrite={can("attendance:write")}
          canReopen={roleRank(role) >= roleRank("ORG_ADMIN")}
        />
      </SectionCard>
    </main>
  );
}
