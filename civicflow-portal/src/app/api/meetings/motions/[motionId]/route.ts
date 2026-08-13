import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { decideMotion } from "@/lib/meeting-operations";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  status: z.enum(["SECONDED", "PASSED", "FAILED", "TABLED", "WITHDRAWN"]),
  votesYes: z.number().int().min(0).nullable().optional(),
  votesNo: z.number().int().min(0).nullable().optional(),
  votesAbstain: z.number().int().min(0).nullable().optional(),
  voteMethod: z.string().max(120).nullable().optional(),
  discussionNotes: z.string().max(8000).nullable().optional(),
});

/** PTA-C: decide a motion. PASSED allocates the next per-org decision
 * number ("2026-014") transactionally; decided motions are final. */
export async function PATCH(request: Request, { params }: { params: Promise<{ motionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("meetings:write", "throw");
    const { motionId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const motion = await decideMotion({
      organizationId,
      motionId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: motion });
  });
}
