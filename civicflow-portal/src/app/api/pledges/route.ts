import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { campaignPledgeTotals, createPledge, listPledges } from "@/lib/giving/pledges";
import { ensureContributionsEnabled } from "@/lib/giving/module";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/pledges[?campaignId=] — officer pledge list (+ campaign totals
 * when a campaign is named). Requires contributions:pledges:view. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("contributions:pledges:view", "throw");
    await ensureContributionsEnabled(organizationId);
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get("campaignId");
    const [pledges, totals] = await Promise.all([
      listPledges(organizationId),
      campaignId ? campaignPledgeTotals(organizationId, campaignId) : Promise.resolve(null),
    ]);
    return Response.json({ ok: true, data: { pledges, campaignTotals: totals } });
  });
}

const createSchema = z.object({
  contributorUserId: z.string().min(1).max(64),
  memberId: z.string().max(64).nullable().optional(),
  fundId: z.string().min(1).max(64),
  pledgedAmount: z.number().positive().max(10_000_000),
  campaignId: z.string().max(64).nullable().optional(),
  targetCompletionDate: z.coerce.date().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

/** POST — an officer records a pledge ON BEHALF of a member (a pledge card
 * from the annual meeting, for example). The contributor must actually
 * belong to this organization. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("contributions:pledges:manage", "throw");
    const input = await parseJsonBody(request, createSchema);

    const membership = await prisma.organizationMembership.findFirst({
      where: { organizationId, userId: input.contributorUserId, status: "active" },
    });
    if (!membership) {
      return Response.json({ ok: false, error: "That person is not a member of this organization." }, { status: 404 });
    }

    const pledge = await createPledge({
      organizationId,
      contributorUserId: input.contributorUserId,
      memberId: input.memberId ?? null,
      fundId: input.fundId,
      pledgedAmount: input.pledgedAmount,
      campaignId: input.campaignId ?? null,
      targetCompletionDate: input.targetCompletionDate ?? null,
      notes: input.notes ?? null,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: pledge }, { status: 201 });
  });
}
