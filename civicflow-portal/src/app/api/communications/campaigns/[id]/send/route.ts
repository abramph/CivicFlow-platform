import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { sendCommunicationCampaign } from "@/lib/communication-campaigns";
import { requireRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:communications:send",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("communications:write", "throw");
    const { id } = await params;
    const result = await sendCommunicationCampaign({ organizationId, campaignId: id, actorUserId: session.userId, actorEmail: session.userEmail });
    return Response.json({ ok: true, data: result });
  });
}
