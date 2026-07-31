import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";

/** Roster for the event's QR attendance session — mirrors the read side of
 * /api/meetings/[id]/attendance. Manual entry for events already goes through
 * the generic /api/attendance (eventId-scoped) rather than a bulk worksheet,
 * so only GET is needed here. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("attendance:read", "throw");
    const { id } = await params;
    const rows = await prisma.attendanceRecord.findMany({
      where: { organizationId, eventId: id },
      include: { member: true },
      orderBy: [{ member: { lastName: "asc" } }, { member: { firstName: "asc" } }],
    });
    return Response.json({ ok: true, data: rows });
  });
}
