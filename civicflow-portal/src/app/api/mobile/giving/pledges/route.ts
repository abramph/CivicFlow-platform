import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { createPledge } from "@/lib/giving/pledges";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  fundId: z.string().min(1).max(64),
  amount: z.number().positive().max(10_000_000),
  targetCompletionDate: z.string().max(30).nullable().optional(),
});

/** CORE-GIVE-L — make a pledge from mobile. A stated intention, never debt
 * (§22) — the E lib's wording and rules apply unchanged. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, bodySchema);
    const { session: mobileSession, organizationId, memberId } = await requireMobileMembership(request, input.organizationId);
    const pledge = await createPledge({
      organizationId,
      contributorUserId: mobileSession.userId,
      memberId,
      fundId: input.fundId,
      pledgedAmount: input.amount,
      targetCompletionDate: input.targetCompletionDate ? new Date(input.targetCompletionDate) : null,
      actorUserId: mobileSession.userId,
    });
    return Response.json({ ok: true, data: { id: pledge.id } }, { status: 201 });
  });
}
