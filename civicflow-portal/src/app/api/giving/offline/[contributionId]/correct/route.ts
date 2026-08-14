import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { correctOfflineContribution, OFFLINE_METHODS } from "@/lib/giving/offline";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  reason: z.string().min(1).max(500),
  corrected: z.object({
    fundId: z.string().min(1).max(64),
    amount: z.number().positive().max(1_000_000),
    method: z.enum(OFFLINE_METHODS as [string, ...string[]]),
    contributionDate: z.coerce.date(),
    memberId: z.string().max(64).nullable().optional(),
    contributorName: z.string().max(200).nullable().optional(),
    anonymous: z.boolean().optional(),
    reference: z.string().max(120).nullable().optional(),
    memo: z.string().max(500).nullable().optional(),
    pledgeId: z.string().max(64).nullable().optional(),
  }),
});

/** CORE-GIVE-F — §100 correction: VOID the original (with reason) and
 * create a linked replacement. Never destructive; provider-processed rows
 * are refused (those correct through refunds). */
export async function POST(request: Request, { params }: { params: Promise<{ contributionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("contributions:offline:create", "throw");
    const { contributionId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const result = await correctOfflineContribution({
      organizationId,
      contributionId,
      reason: input.reason,
      corrected: { ...input.corrected, method: input.corrected.method as (typeof OFFLINE_METHODS)[number] },
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: result });
  });
}
