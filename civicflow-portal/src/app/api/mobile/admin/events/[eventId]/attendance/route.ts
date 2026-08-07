import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { resolveMobileAdminCapabilities } from "@/lib/mobile-admin";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/** GET /api/mobile/admin/events/[eventId]/attendance?organizationId=...
 * Roster for the event's QR attendance session -- mirrors the read side of
 * src/app/api/events/[id]/attendance/route.ts. */
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { userId } = await requireMobileAuth(request);
    const admin = await resolveMobileAdminCapabilities(organizationId, userId);
    if (!admin.available || !admin.adminCapabilities.includes("manageAttendance")) {
      throw new MobileForbiddenError("No mobile attendance administration access for this organization");
    }
    const { eventId } = await params;

    const rows = await prisma.attendanceRecord.findMany({
      where: { organizationId, eventId },
      select: {
        id: true,
        attendanceStatus: true,
        checkInTime: true,
        method: true,
        correctionReason: true,
        member: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ member: { lastName: "asc" } }, { member: { firstName: "asc" } }],
    });

    return Response.json({ ok: true, data: rows });
  });
}
