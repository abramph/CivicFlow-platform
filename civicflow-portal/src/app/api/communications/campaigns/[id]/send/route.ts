import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { sendCommunicationCampaign } from "@/lib/communication-campaigns";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("communications:write", "throw");
    const { id } = await params;
    const result = await sendCommunicationCampaign({ organizationId, campaignId: id, actorUserId: session.userId, actorEmail: session.userEmail });
    return Response.json({ ok: true, data: result });
  });
}
