import { withApiErrorHandling } from "@/lib/api-route";
import { requireUnionCaseManage, requireUnionCaseClose } from "@/lib/union/cases-guard";
import { transitionUnionCaseStatus } from "@/lib/union/cases";
import { parseJsonBody, z } from "@/lib/validation";

// ASSIGNED is deliberately excluded -- the only path to ASSIGNED is
// .../assign (which bundles setting assignedToOrgMemberId with the status
// bump), so a plain transition can never land a case in ASSIGNED with no
// assignee. WITHDRAWN here is the staff-recorded path for "the member
// called and said never mind" -- the member's own self-service withdrawal
// goes through a separate guard (requireUnionCaseMemberAccess), not this
// route.
const MANAGE_TARGETS = ["TRIAGE", "ACTIVE", "PENDING", "WITHDRAWN"] as const;
const CLOSE_TARGETS = ["RESOLVED", "CLOSED"] as const;

const transitionSchema = z.object({
  toStatus: z.enum([...MANAGE_TARGETS, ...CLOSE_TARGETS]),
  notes: z.string().max(2000).nullable().optional(),
  resolutionSummary: z.string().max(5000).nullable().optional(),
});

/**
 * Every staff-initiated transition. Required permission depends on the
 * target status, not just the route, so the body is parsed before the
 * guard runs -- mirrors .../hoa/architectural-requests/[requestId]/transition/route.ts's
 * exact reasoning: RESOLVED/CLOSED are the terminal, record-closing
 * actions (union:cases:close, board-level authority only); every other
 * target is ordinary case administration (union:cases:manage).
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  return withApiErrorHandling(async () => {
    const { caseId } = await params;
    const input = await parseJsonBody(request, transitionSchema);

    const requiresCloseAuthority = (CLOSE_TARGETS as readonly string[]).includes(input.toStatus);
    const { organizationId, session } = requiresCloseAuthority ? await requireUnionCaseClose() : await requireUnionCaseManage();

    const updated = await transitionUnionCaseStatus({
      organizationId,
      caseId,
      toStatus: input.toStatus,
      notes: input.notes,
      resolutionSummary: input.resolutionSummary,
      actorUserId: session.userId,
    });
    return Response.json({ ok: true, data: updated });
  });
}
