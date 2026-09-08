import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { setAnnouncementArchivedForMember } from "@/lib/mobile-announcements";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ organizationId: z.string().min(1), archived: z.boolean() });

/**
 * POST /api/mobile/announcements/[id]/archive — [id] is the
 * CommunicationCampaign id, matching the read route. Archives (or, with
 * archived:false, restores) the caller's OWN recipient row only: this is a
 * personal inbox action that never deletes anything and never affects any
 * other recipient's view. Idempotent, so a retry is always safe.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:mobile:announcements:archive", request, limit: 60, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, bodySchema);
    const { organizationId, memberId } = await requireMobileMembership(request, input.organizationId);
    const { id: campaignId } = await params;

    await setAnnouncementArchivedForMember(organizationId, memberId, campaignId, input.archived);

    return Response.json({ ok: true });
  });
}
