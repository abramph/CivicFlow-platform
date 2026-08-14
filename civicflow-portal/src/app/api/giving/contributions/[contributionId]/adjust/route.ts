import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { adjustContribution } from "@/lib/giving/refunds";
import { parseJsonBody, z } from "@/lib/validation";

const postSchema = z.object({
  kind: z.enum(["FUND_RECLASSIFICATION", "ATTRIBUTION_CORRECTION"]),
  newFundId: z.string().max(64).nullable().optional(),
  newMemberId: z.string().max(64).nullable().optional(),
  newContributorName: z.string().max(120).nullable().optional(),
  reason: z.string().min(1).max(500),
});

/** CORE-GIVE-K (§100) — controlled adjustment (money fields untouchable).
 * Data-entry authority, permanent before/after trail. */
export async function POST(request: Request, { params }: { params: Promise<{ contributionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { contributionId } = await params;
    const { organizationId, session } = await requirePermission("contributions:offline:create", "throw");
    const input = await parseJsonBody(request, postSchema);
    const adjustment = await adjustContribution({
      organizationId,
      contributionId,
      kind: input.kind,
      newFundId: input.newFundId ?? null,
      newMemberId: input.newMemberId ?? null,
      newContributorName: input.newContributorName ?? null,
      reason: input.reason,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: { adjustmentId: adjustment.id } }, { status: 201 });
  });
}
