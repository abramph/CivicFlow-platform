import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { AttendanceRecordForm } from "@/components/forms/AttendanceRecordForm";

function getValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function NewAttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await requirePermission("attendance:write");
  const resolvedSearchParams = await searchParams;
  const [members, events] = await Promise.all([
    prisma.orgMember.findMany({
      where: { organizationId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true },
      take: 300,
    }),
    prisma.event.findMany({
      where: { organizationId },
      orderBy: [{ startAt: "desc" }, { title: "asc" }],
      select: { id: true, title: true, startAt: true },
      take: 150,
    }),
  ]);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Record Attendance"
        description="Record attendance for an event or a general meeting."
        actions={[
          { href: "/attendance", label: "Back to Attendance" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />
      <SectionCard title="Attendance Entry" description="Select an event or enter a meeting title for standalone meetings.">
        <AttendanceRecordForm
          members={members.map((member) => ({ id: member.id, label: `${member.lastName}, ${member.firstName}` }))}
          events={events.map((event) => ({ id: event.id, label: event.title, startAt: event.startAt?.toISOString() ?? null }))}
          defaults={{
            memberId: getValue(resolvedSearchParams.memberId),
            eventId: getValue(resolvedSearchParams.eventId),
            meetingTitle: getValue(resolvedSearchParams.meetingTitle),
          }}
        />
      </SectionCard>
    </main>
  );
}

