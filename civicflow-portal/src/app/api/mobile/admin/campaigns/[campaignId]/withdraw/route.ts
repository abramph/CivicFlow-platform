import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { requireMobileAdminAccess } from "@/lib/mobile-admin";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  reason: z.union([z.string().trim().max(1000), z.null()]).optional(),
});

/**
 * POST /api/mobile/admin/campaigns/[campaignId]/withdraw
 *
 * Build 27 — administrative recall of a SENT announcement. Withdrawal hides
 * the announcement from every member-facing list (see
 * mobile-announcements.ts) while preserving the campaign row, every
 * recipient/delivery record, and the audit trail — an administrator can
 * never erase communication history without trace, and admin surfaces
 * label withdrawn content rather than pretending it never went out.
 * Delivered emails/SMS obviously cannot be pulled back from recipients'
 * own inboxes; withdrawal governs what THIS system continues to show.
 *
 * Conditional update (withdrawnAt: null) — exactly one of two racing
 * withdrawals wins; the loser gets a clean conflict.
 */
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:mobile:admin:campaigns:lifecycle", request, limit: 20, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, reason } = await parseJsonBody(request, bodySchema);
    const { userId, email } = await requireMobileAuth(request);
    const admin = await requireMobileAdminAccess(organizationId, userId);
    if (!admin.available || !admin.adminCapabilities.includes("manageCommunications")) {
      throw new MobileForbiddenError("No mobile communications administration access for this organization");
    }
    const { campaignId } = await params;

    const campaign = await prisma.communicationCampaign.findFirst({
      where: { id: campaignId, organizationId },
      select: { id: true, status: true, withdrawnAt: true },
    });
    if (!campaign) {
      return Response.json({ ok: false, error: "Campaign not found" }, { status: 404 });
    }
    if (campaign.withdrawnAt) {
      return Response.json({ ok: false, error: "This announcement has already been withdrawn." }, { status: 409 });
    }
    if (campaign.status !== "SENT") {
      return Response.json(
        { ok: false, error: "Only a sent announcement can be withdrawn. Delete an unsent draft instead." },
        { status: 409 }
      );
    }

    const claimed = await prisma.communicationCampaign.updateMany({
      where: { id: campaignId, organizationId, status: "SENT", withdrawnAt: null },
      data: { withdrawnAt: new Date(), withdrawnByUserId: userId },
    });
    if (claimed.count === 0) {
      return Response.json({ ok: false, error: "This announcement has already been withdrawn." }, { status: 409 });
    }

    await createAuditEvent({
      organizationId,
      actorUserId: userId,
      actorEmail: email ?? null,
      action: "communication_campaign.withdrawn",
      entityType: "communication_campaign",
      entityId: campaignId,
      metadata: { reason: reason ?? null },
    });

    return Response.json({ ok: true });
  });
}
