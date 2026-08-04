import { withApiErrorHandling } from "@/lib/api-route";
import { requireHoaViolationResolve, requireHoaViolationReview } from "@/lib/hoa/violations-guard";
import { isTerminalStatus, transitionViolationStatus } from "@/lib/hoa/violations";
import { parseJsonBody, z } from "@/lib/validation";

const NON_TERMINAL_TARGETS = ["ACKNOWLEDGED", "IN_REVIEW", "CURED"] as const;
const TERMINAL_TARGETS = ["CURED", "RESOLVED", "DISMISSED"] as const;

const transitionSchema = z.object({
  toStatus: z.enum([...NON_TERMINAL_TARGETS, ...TERMINAL_TARGETS]),
  notes: z.string().max(2000).nullable().optional(),
  resolutionNotes: z.string().max(5000).nullable().optional(),
});

/**
 * Every transition except DRAFT->ISSUED (see .../issue/route.ts). Required
 * permission depends on the target status, not just the route, so the
 * body is parsed before the guard runs here (unlike every other route in
 * this codebase, where the guard always runs first) — the guard call
 * itself is still the only thing that can actually authorize the request;
 * parsing first only decides *which* guard to call.
 *   - ACKNOWLEDGED / IN_REVIEW: hoa:violations:review (STAFF and above)
 *   - CURED / RESOLVED / DISMISSED: hoa:violations:resolve (board-level
 *     only — closing the compliance record is reserved for ORG_OWNER/
 *     ORG_ADMIN, matching MEETINGS_MINUTES_APPROVE's precedent).
 * CURED is reachable via either permission tier (see the state machine in
 * violations.ts) since "the issue got fixed" is sometimes confirmed
 * during ordinary review, not only as a formal board closure.
 */
export async function POST(request: Request, { params }: { params: Promise<{ violationId: string }> }) {
  return withApiErrorHandling(async () => {
    const { violationId } = await params;
    const input = await parseJsonBody(request, transitionSchema);

    const requiresResolveAuthority = (TERMINAL_TARGETS as readonly string[]).includes(input.toStatus) && input.toStatus !== "CURED";
    const { organizationId, session } = requiresResolveAuthority
      ? await requireHoaViolationResolve()
      : await requireHoaViolationReview();

    const violation = await transitionViolationStatus({
      organizationId,
      violationId,
      toStatus: input.toStatus,
      notes: input.notes,
      resolutionNotes: isTerminalStatus(input.toStatus) ? input.resolutionNotes : undefined,
      actorUserId: session.userId,
    });
    return Response.json({ ok: true, data: violation });
  });
}
