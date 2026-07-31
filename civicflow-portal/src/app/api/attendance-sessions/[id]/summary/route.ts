import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";

/**
 * Lightweight counts-only endpoint for the live roster polling loop — the
 * admin UI hits this far more often than the full roster fetch, so it stays
 * a single grouped count query rather than pulling every member row.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("attendance:read", "throw");
    const { id } = await params;

    const session = await prisma.meetingAttendanceSession.findFirst({ where: { id, organizationId } });
    if (!session) return Response.json({ ok: false, error: "Attendance session not found" }, { status: 404 });

    const [eligibleCount, statusCounts] = await Promise.all([
      prisma.orgMember.count({ where: { organizationId, membershipStatus: "active" } }),
      prisma.attendanceRecord.groupBy({
        by: ["attendanceStatus"],
        where: session.meetingId
          ? { organizationId, meetingId: session.meetingId }
          : { organizationId, eventId: session.eventId },
        _count: true,
      }),
    ]);

    const counts = { PRESENT: 0, LATE: 0, EXCUSED: 0, ABSENT: 0, VIRTUAL: 0 };
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
