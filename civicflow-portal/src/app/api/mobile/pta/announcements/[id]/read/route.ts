import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { markAnnouncementReadForMember } from "@/lib/mobile-announcements";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ organizationId: z.string().min(1) });

/** POST /api/mobile/pta/announcements/[id]/read — marks the household's own delivery record as read via its billing member id. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, bodySchema);
    const { organizationId, adult } = await requireMobilePtaHouseholdAccess(request, input.organizationId);
    const { id: campaignId } = await params;

    if (adult.billingMemberId) {
      await markAnnouncementReadForMember(organizationId, adult.billingMemberId, campaignId);
    }

    return Response.json({ ok: true });
  });
}
