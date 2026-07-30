import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { markAnnouncementReadForMember } from "@/lib/mobile-announcements";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ organizationId: z.string().min(1) });

/**
 * POST /api/mobile/announcements/[id]/read — [id] is the CommunicationCampaign
 * id (matching the shape returned by GET /api/mobile/announcements), not the
 * CommunicationRecipient row itself. Marks the caller's own delivery record
 * as read; a member can only mark their own receipt, never anyone else's.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, bodySchema);
    const { organizationId, memberId } = await requireMobileMembership(request, input.organizationId);
    const { id: campaignId } = await params;

    await markAnnouncementReadForMember(organizationId, memberId, campaignId);

    return Response.json({ ok: true });
  });
}
