import { withApiErrorHandling } from "@/lib/api-route";
import { requireArchitecturalRequestDecide, requireArchitecturalRequestReview } from "@/lib/hoa/architectural-requests-guard";
import { transitionArchitecturalRequestStatus } from "@/lib/hoa/architectural-requests";
import { parseJsonBody, z } from "@/lib/validation";

const REVIEW_TARGETS = ["IN_REVIEW", "CHANGES_REQUESTED"] as const;
const DECIDE_TARGETS = ["APPROVED", "CONDITIONALLY_APPROVED", "DENIED", "EXPIRED"] as const;

const transitionSchema = z.object({
  toStatus: z.enum([...REVIEW_TARGETS, ...DECIDE_TARGETS]),
  notes: z.string().max(2000).nullable().optional(),
  decisionSummary: z.string().max(5000).nullable().optional(),
  conditions: z.string().max(5000).nullable().optional(),
});

/**
 * Every officer-initiated transition. Required permission depends on the
 * target status, not just the route, so the body is parsed before the
 * guard runs — mirrors .../violations/[violationId]/transition/route.ts's
 * exact reasoning:
 *   - IN_REVIEW / CHANGES_REQUESTED: hoa:architectural-requests:review
 *     (STAFF and above, including an ARC reviewer invited as STAFF).
 *   - APPROVED / CONDITIONALLY_APPROVED / DENIED / EXPIRED:
 *     hoa:architectural-requests:decide (board-level only — the terminal,
 *     record-closing decision, reserved for ORG_OWNER/ORG_ADMIN).
 */
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return withApiErrorHandling(async () => {
    const { requestId } = await params;
    const input = await parseJsonBody(request, transitionSchema);

    const requiresDecideAuthority = (DECIDE_TARGETS as readonly string[]).includes(input.toStatus);
    const { organizationId, session } = requiresDecideAuthority
      ? await requireArchitecturalRequestDecide()
      : await requireArchitecturalRequestReview();

    const result = await transitionArchitecturalRequestStatus({
      organizationId,
      requestId,
      toStatus: input.toStatus,
      notes: input.notes,
      decisionSummary: input.decisionSummary,
      conditions: input.conditions,
      actorUserId: session.userId,
    });
    return Response.json({ ok: true, data: result });
  });
}
