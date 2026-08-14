import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { ensureContributionsEnabled } from "@/lib/giving/module";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody, z } from "@/lib/validation";

/** CORE-GIVE-J (§24) — which campaigns show public progress. Financial-
 * configuration authority, audited. Only goal + raised TOTAL ever go
 * public; donor rows never do. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("contributions:funds:manage", "throw");
    await ensureContributionsEnabled(organizationId);
    const campaigns = await prisma.campaign.findMany({
      where: { organizationId, status: "active" },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, goal: true, showPublicProgress: true },
      take: 100,
    });
    return Response.json({
      ok: true,
      data: campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        goal: campaign.goal !== null ? Number(campaign.goal) : null,
        showPublicProgress: campaign.showPublicProgress,
      })),
    });
  });
}

const patchSchema = z.object({
  campaignId: z.string().min(1).max(64),
  showPublicProgress: z.boolean(),
});

export async function PATCH(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("contributions:funds:manage", "throw");
    await ensureContributionsEnabled(organizationId);
    const input = await parseJsonBody(request, patchSchema);
    const campaign = await prisma.campaign.findFirst({ where: { id: input.campaignId, organizationId } });
    if (!campaign) return Response.json({ ok: false, error: "Campaign not found." }, { status: 404 });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { showPublicProgress: input.showPublicProgress } });
    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "giving.campaign_public_progress_changed",
      entityType: "campaign",
      entityId: campaign.id,
      metadata: { showPublicProgress: input.showPublicProgress },
    });
    return Response.json({ ok: true });
  });
}
