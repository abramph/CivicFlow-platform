import { withApiErrorHandling } from "@/lib/api-route";
import { requireUnionCaseRead } from "@/lib/union/cases-guard";
import { listUnionCases } from "@/lib/union/cases";

const STATUSES = ["NEW", "TRIAGE", "ASSIGNED", "ACTIVE", "PENDING", "RESOLVED", "CLOSED", "WITHDRAWN"] as const;

/** Staff directory -- creation is member-initiated only (see
 * .../my/route.ts POST), so there is no staff-facing POST here. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireUnionCaseRead();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const assignedToOrgMemberId = url.searchParams.get("assignedToOrgMemberId");
    const cases = await listUnionCases(organizationId, {
      status: STATUSES.includes(status as (typeof STATUSES)[number]) ? (status as (typeof STATUSES)[number]) : undefined,
      assignedToOrgMemberId: assignedToOrgMemberId ?? undefined,
    });
    return Response.json({ ok: true, data: cases });
  });
}
