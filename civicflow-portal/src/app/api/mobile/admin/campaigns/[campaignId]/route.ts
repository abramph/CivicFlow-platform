import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { requireMobileAdminAccess } from "@/lib/mobile-admin";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/validation";

async function requireManageCommunications(request: Request, organizationId: string) {
  const { userId, email } = await requireMobileAuth(request);
  const admin = await requireMobileAdminAccess(organizationId, userId);
  if (!admin.available || !admin.adminCapabilities.includes("manageCommunications")) {
    throw new MobileForbiddenError("No mobile communications administration access for this organization");
  }
  return { userId, email };
}

/** GET /api/mobile/admin/campaigns/[campaignId]?organizationId=...
 * Always re-fetched fresh -- never trusts a campaign object passed through
 * navigation as authorization, matching the rest of this app's convention. */
export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireManageCommunications(request, organizationId);
    const { campaignId } = await params;

    const campaign = await prisma.communicationCampaign.findFirst({
      where: { id: campaignId, organizationId },
      include: { _count: { select: { recipients: true } } },
    });
    if (!campaign) {
      return Response.json({ ok: false, error: "Campaign not found" }, { status: 404 });
    }

    return Response.json({ ok: true, data: campaign });
  });
}

/**
 * DELETE /api/mobile/admin/campaigns/[campaignId]?organizationId=...
 *
 * Build 27 — deletes an UNSENT DRAFT only. Anything that has entered the
 * send pipeline (READY, SENDING, SENT, FAILED — a FAILED campaign may have
 * partially delivered) is never hard-deleted: sent history stays; a SENT
 * announcement is recalled via /withdraw instead. The deletion itself is
 * audited (id + status only), so even a draft never disappears without
 * trace.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:mobile:admin:campaigns:lifecycle", request, limit: 20, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { userId, email } = await requireManageCommunications(request, organizationId);
    const { campaignId } = await params;

    const campaign = await prisma.communicationCampaign.findFirst({
      where: { id: campaignId, organizationId },
      select: { id: true, status: true },
    });
    if (!campaign) {
      return Response.json({ ok: false, error: "Campaign not found" }, { status: 404 });
    }
    if (campaign.status !== "DRAFT") {
      return Response.json(
        { ok: false, error: "Only an unsent draft can be deleted. Withdraw a sent announcement instead." },
        { status: 409 }
      );
    }

    // Conditional delete — if another admin sends the draft between the read
    // above and this statement, deleteMany matches zero rows and nothing is
    // lost.
    const deleted = await prisma.communicationCampaign.deleteMany({ where: { id: campaignId, organizationId, status: "DRAFT" } });
    if (deleted.count === 0) {
      return Response.json(
        { ok: false, error: "Only an unsent draft can be deleted. Withdraw a sent announcement instead." },
        { status: 409 }
      );
    }

    await createAuditEvent({
      organizationId,
      actorUserId: userId,
      actorEmail: email ?? null,
      action: "communication_campaign.draft_deleted",
      entityType: "communication_campaign",
      entityId: campaignId,
      metadata: {},
    });

    return Response.json({ ok: true });
  });
}
