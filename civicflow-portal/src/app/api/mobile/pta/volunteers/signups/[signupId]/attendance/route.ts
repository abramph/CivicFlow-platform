import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileStaffPermission } from "@/lib/mobile-auth";
import { setPtaVolunteerAttendanceStatus } from "@/lib/labs/pta/volunteers";
import { PERMISSIONS } from "@/lib/rbac";
import { parseJsonBody } from "@/lib/validation";
import { z } from "zod";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  status: z.enum(["ATTENDED", "PARTIAL", "NO_SHOW", "EXCUSED"]),
  manualMinutes: z.number().int().min(0).nullable().optional(),
});

/**
 * POST /api/mobile/pta/volunteers/signups/[signupId]/attendance
 * Body: { organizationId, status, manualMinutes? }
 * Confirms the final attendance outcome — a separate, explicit step from
 * check-in/check-out (see docs/pta-volunteer-management.md's "Attendance
 * workflow" section). Confirming ATTENDED/PARTIAL auto-proposes a PENDING
 * hour entry via the same precedence engine the web uses.
 */
export async function POST(request: Request, { params }: { params: Promise<{ signupId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, status, manualMinutes } = await parseJsonBody(request, bodySchema);

    const { organizationId: verifiedOrgId, session } = await requireMobileStaffPermission(request, organizationId, PERMISSIONS.PTA_VOLUNTEERS_CHECKIN);
    const { signupId } = await params;

    const result = await setPtaVolunteerAttendanceStatus(verifiedOrgId, signupId, status, session.userId, { manualMinutes: manualMinutes ?? null }, session.email);
    return Response.json({ ok: true, data: result });
  });
}
