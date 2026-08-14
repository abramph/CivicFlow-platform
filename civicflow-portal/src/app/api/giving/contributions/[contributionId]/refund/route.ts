import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { issueRefund } from "@/lib/giving/refunds";
import { parseJsonBody, z } from "@/lib/validation";

const postSchema = z.object({
  amount: z.number().positive().max(1_000_000).nullable().optional(),
  reason: z.string().min(1).max(500),
});

/** CORE-GIVE-K (§34) — issue a provider refund. contributions:refund is its
 * own capability (§111.9); the row is marked only from provider truth. */
export async function POST(request: Request, { params }: { params: Promise<{ contributionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { contributionId } = await params;
    const { organizationId, session } = await requirePermission("contributions:refund", "throw");
    const input = await parseJsonBody(request, postSchema);
    const result = await issueRefund({
      organizationId,
      contributionId,
      amount: input.amount ?? null,
      reason: input.reason,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: result });
  });
}
