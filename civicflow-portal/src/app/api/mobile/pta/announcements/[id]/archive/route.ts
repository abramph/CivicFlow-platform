import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { setAnnouncementArchivedForMember } from "@/lib/mobile-announcements";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ organizationId: z.string().min(1), archived: z.boolean() });

/**
 * POST /api/mobile/pta/announcements/[id]/archive — the household-authorized
 * twin of the member archive route. The recipient row is the household's
 * shared billing identity, so — exactly like read state — archive state is
 * shared between the household's adults (docs/pta-communication-identity.md).
 * Never affects any other household, never deletes anything, idempotent.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:mobile:announcements:archive", request, limit: 60, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, bodySchema);
    const { organizationId, adult } = await requireMobilePtaHouseholdAccess(request, input.organizationId);
    const { id: campaignId } = await params;

    if (adult.billingMemberId) {
      await setAnnouncementArchivedForMember(organizationId, adult.billingMemberId, campaignId, input.archived);
    }

    return Response.json({ ok: true });
  });
}
