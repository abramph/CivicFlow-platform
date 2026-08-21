import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { requireMobileAdminAccess } from "@/lib/mobile-admin";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/** GET /api/mobile/admin/campaigns/[campaignId]?organizationId=...
 * Always re-fetched fresh -- never trusts a campaign object passed through
 * navigation as authorization, matching the rest of this app's convention. */
export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { userId } = await requireMobileAuth(request);
    const admin = await requireMobileAdminAccess(organizationId, userId);
    if (!admin.available || !admin.adminCapabilities.includes("manageCommunications")) {
      throw new MobileForbiddenError("No mobile communications administration access for this organization");
    }
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
