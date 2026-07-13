import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/** GET /api/mobile/attendance/history?organizationId=... — the member's own
 * attendance records, scoped to their own memberId (never another member's,
 * even within the same org) and to the organization they're actually asking
 * about (re-derived/verified, not trusted from the query string alone). */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { memberId } = await requireMobileMembership(request, organizationId);

    const rows = await prisma.attendanceRecord.findMany({
      where: { organizationId, memberId },
      orderBy: { meetingDate: "desc" },
      take: 100,
      select: {
        id: true,
        meetingId: true,
        meetingTitle: true,
        meetingDate: true,
        attendanceStatus: true,
        checkInTime: true,
        method: true,
      },
    });

    return Response.json({ ok: true, data: rows });
  });
}
