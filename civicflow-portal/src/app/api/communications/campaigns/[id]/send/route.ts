import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { sendCommunicationCampaign } from "@/lib/communication-campaigns";
import { requireRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";

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

    // sendCommunicationCampaign() short-circuits as a no-op for a campaign
    // already in FAILED status (so the cron worker never retries one
    // forever) — an explicit "Send Campaign" click is exactly the case that
    // check must NOT apply to, or a campaign that failed for any reason
    // (billing, a lapsed plan feature, WhatsApp entitlement) could never be
    // resent through this button at all. Mirrors the same reset-then-retry
    // pattern already used for the manual SMS Retry action.
    await prisma.communicationCampaign.updateMany({
      where: { id, organizationId, status: "FAILED" },
      data: { status: "READY" },
    });

    const result = await sendCommunicationCampaign({ organizationId, campaignId: id, actorUserId: session.userId, actorEmail: session.userEmail });
    return Response.json({ ok: true, data: result });
  });
}
