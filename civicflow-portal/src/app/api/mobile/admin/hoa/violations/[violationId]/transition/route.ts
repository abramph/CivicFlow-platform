import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileHoaPermission } from "@/lib/mobile-admin-hoa";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { isTerminalStatus, transitionViolationStatus } from "@/lib/hoa/violations";

const NON_TERMINAL_TARGETS = ["ACKNOWLEDGED", "IN_REVIEW", "CURED"] as const;
const TERMINAL_TARGETS = ["CURED", "RESOLVED", "DISMISSED"] as const;

const transitionSchema = z.object({
  organizationId: z.string().min(1),
  toStatus: z.enum([...NON_TERMINAL_TARGETS, ...TERMINAL_TARGETS]),
  notes: z.string().max(2000).nullable().optional(),
  resolutionNotes: z.string().max(5000).nullable().optional(),
});

type RouteParams = { params: Promise<{ violationId: string }> };

/**
 * POST /api/mobile/admin/hoa/violations/[violationId]/transition
 *
 * Every transition except DRAFT->ISSUED. Mirrors the web route's exact
 * dynamic-permission logic: RESOLVED/DISMISSED require HOA_VIOLATIONS_RESOLVE
 * (board-level, STAFF deliberately excluded); ACKNOWLEDGED/IN_REVIEW/CURED
 * only require HOA_VIOLATIONS_REVIEW — CURED is reachable via either tier
 * since "the issue got fixed" is sometimes confirmed during ordinary review,
 * not only as a formal board closure (see transitionViolationStatus's doc
 * comment in violations.ts).
 */
export async function POST(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:hoa:violations:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { violationId } = await params;
    const { organizationId, ...input } = await parseJsonBody(request, transitionSchema);

    const requiresResolveAuthority = (TERMINAL_TARGETS as readonly string[]).includes(input.toStatus) && input.toStatus !== "CURED";
    const permission = requiresResolveAuthority ? PERMISSIONS.HOA_VIOLATIONS_RESOLVE : PERMISSIONS.HOA_VIOLATIONS_REVIEW;
    const { userId } = await requireMobileHoaPermission(request, organizationId, "manageHoaViolations", permission);

    const violation = await transitionViolationStatus({
      organizationId,
      violationId,
      toStatus: input.toStatus,
      notes: input.notes,
      resolutionNotes: isTerminalStatus(input.toStatus) ? input.resolutionNotes : undefined,
      actorUserId: userId,
    });
    return Response.json({ ok: true, data: violation });
  });
}
