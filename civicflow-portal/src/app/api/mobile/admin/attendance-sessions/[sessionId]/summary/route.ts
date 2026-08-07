import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { resolveMobileAdminCapabilities } from "@/lib/mobile-admin";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";
import type { AttendanceStatus } from "@prisma/client";

/** GET /api/mobile/admin/attendance-sessions/[sessionId]/summary?organizationId=...
 * Mirrors src/app/api/attendance-sessions/[id]/summary/route.ts exactly --
 * lightweight counts-only endpoint for a live roster polling loop. */
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { userId } = await requireMobileAuth(request);
    const admin = await resolveMobileAdminCapabilities(organizationId, userId);
    if (!admin.available || !admin.adminCapabilities.includes("manageAttendance")) {
      throw new MobileForbiddenError("No mobile attendance administration access for this organization");
    }
    const { sessionId } = await params;

    const session = await prisma.meetingAttendanceSession.findFirst({ where: { id: sessionId, organizationId } });
    if (!session) return Response.json({ ok: false, error: "Attendance session not found" }, { status: 404 });

    const [eligibleCount, statusCounts] = await Promise.all([
      prisma.orgMember.count({ where: { organizationId, membershipStatus: "active" } }),
      prisma.attendanceRecord.groupBy({
        by: ["attendanceStatus"],
        where: session.meetingId ? { organizationId, meetingId: session.meetingId } : { organizationId, eventId: session.eventId },
        _count: true,
      }),
    ]);

    const counts: Record<AttendanceStatus, number> = { PRESENT: 0, LATE: 0, EXCUSED: 0, ABSENT: 0, VIRTUAL: 0 };
    let checkedIn = 0;
    for (const row of statusCounts) {
      counts[row.attendanceStatus] = row._count;
      checkedIn += row._count;
    }

    return Response.json({
      ok: true,
      data: {
        status: session.status,
        eligibleCount,
        checkedInCount: checkedIn,
        counts,
        attendancePercent: eligibleCount > 0 ? Math.round((checkedIn / eligibleCount) * 1000) / 10 : 0,
      },
    });
  });
}
