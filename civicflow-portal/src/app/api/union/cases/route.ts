import { withApiErrorHandling } from "@/lib/api-route";
import { requireUnionCaseRead } from "@/lib/union/cases-guard";
import { listUnionCases } from "@/lib/union/cases";

const STATUSES = ["NEW", "TRIAGE", "ASSIGNED", "ACTIVE", "PENDING", "RESOLVED", "CLOSED", "WITHDRAWN"] as const;

/** Staff directory -- creation is member-initiated only (see
 * .../my/route.ts POST), so there is no staff-facing POST here. */
const DEADLINE_WINDOWS = ["approaching", "overdue"] as const;

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireUnionCaseRead();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const assignedToOrgMemberId = url.searchParams.get("assignedToOrgMemberId");
    const unassigned = url.searchParams.get("unassigned") === "1";
    const caseType = url.searchParams.get("caseType");
    const deadlineWindow = url.searchParams.get("deadlineWindow");
    const search = url.searchParams.get("search");
    const cases = await listUnionCases(organizationId, {
      status: STATUSES.includes(status as (typeof STATUSES)[number]) ? (status as (typeof STATUSES)[number]) : undefined,
      assignedToOrgMemberId: assignedToOrgMemberId ?? undefined,
      unassigned,
      caseType: caseType ?? undefined,
      deadlineWindow: DEADLINE_WINDOWS.includes(deadlineWindow as (typeof DEADLINE_WINDOWS)[number])
        ? (deadlineWindow as (typeof DEADLINE_WINDOWS)[number])
        : undefined,
      search: search ?? undefined,
    });
    return Response.json({ ok: true, data: cases });
  });
}
