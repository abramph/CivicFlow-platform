import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { resolveMobileAdminCapabilities } from "@/lib/mobile-admin";
import { sendCommunicationCampaign } from "@/lib/communication-campaigns";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ organizationId: z.string().min(1) });

/** POST /api/mobile/admin/campaigns/[campaignId]/send
 * Thin wrapper over the exact same sendCommunicationCampaign() the web
 * "Send Campaign" button uses (src/lib/communication-campaigns.ts) --
 * idempotent/resumable, never a separate mobile send path. */
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:campaigns:send",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId } = await parseJsonBody(request, bodySchema);
    const { userId, email } = await requireMobileAuth(request);
    const admin = await resolveMobileAdminCapabilities(organizationId, userId);
    if (!admin.available || !admin.adminCapabilities.includes("manageCommunications")) {
      throw new MobileForbiddenError("No mobile communications administration access for this organization");
    }
    const { campaignId } = await params;

    const result = await sendCommunicationCampaign({ organizationId, campaignId, actorUserId: userId, actorEmail: email });
    return Response.json({ ok: true, data: result });
  });
}
