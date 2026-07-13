import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/** GET /api/mobile/meetings/[id]/attendance?organizationId=... — the
 * member's own attendance status for one specific meeting (null if they
 * haven't checked in / been recorded). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { memberId } = await requireMobileMembership(request, organizationId);
    const { id } = await params;

    const record = await prisma.attendanceRecord.findUnique({
      where: { organizationId_memberId_meetingId: { organizationId, memberId, meetingId: id } },
      select: { id: true, attendanceStatus: true, checkInTime: true, method: true, correctionReason: true },
    });

    return Response.json({ ok: true, data: record });
  });
}
