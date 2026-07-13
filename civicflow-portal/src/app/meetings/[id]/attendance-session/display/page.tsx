import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { AttendanceFullScreenDisplay } from "@/components/app/AttendanceFullScreenDisplay";

export default async function AttendanceDisplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requirePermission("attendance:write");
  const { id } = await params;
  const [meeting, session, organization] = await Promise.all([
    prisma.meeting.findFirst({ where: { id, organizationId } }),
    prisma.meetingAttendanceSession.findFirst({ where: { organizationId, meetingId: id, status: "OPEN" } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
  ]);

  if (!meeting || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-center text-white">
        <p className="text-xl">Attendance isn&apos;t open for this meeting. Open it first, then reload this page.</p>
      </div>
    );
  }

  return (
    <AttendanceFullScreenDisplay
      sessionId={session.id}
      meetingTitle={meeting.title}
      meetingDate={meeting.meetingDate.toISOString()}
      organizationName={organization?.name ?? ""}
      mode={session.mode}
      opensAt={session.opensAt ? session.opensAt.toISOString() : null}
      closesAt={session.closesAt ? session.closesAt.toISOString() : null}
    />
  );
}
