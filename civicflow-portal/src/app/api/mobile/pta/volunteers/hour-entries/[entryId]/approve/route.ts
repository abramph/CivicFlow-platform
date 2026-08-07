import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileStaffPermission, requirePtaVerticalForMobile } from "@/lib/mobile-auth";
import { approvePtaVolunteerHourEntry } from "@/lib/labs/pta/volunteers";
import { PERMISSIONS } from "@/lib/rbac";
import { parseJsonBody } from "@/lib/validation";
import { z } from "zod";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  adjustedMinutes: z.number().int().min(0).nullable().optional(),
});

/**
 * POST /api/mobile/pta/volunteers/hour-entries/[entryId]/approve
 * Body: { organizationId, adjustedMinutes? }
 * No-self-approval is enforced inside approvePtaVolunteerHourEntry() itself
 * (PTA_SELF_APPROVAL_FORBIDDEN, mapped to 403) — not re-implemented here.
 */
export async function POST(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, adjustedMinutes } = await parseJsonBody(request, bodySchema);

    const { organizationId: verifiedOrgId, session } = await requireMobileStaffPermission(request, organizationId, PERMISSIONS.PTA_VOLUNTEER_HOURS_APPROVE);
    await requirePtaVerticalForMobile(verifiedOrgId);
    const { entryId } = await params;

    const entry = await approvePtaVolunteerHourEntry(verifiedOrgId, entryId, session.userId, { adjustedMinutes: adjustedMinutes ?? null }, session.email);
    return Response.json({ ok: true, data: entry });
  });
}
