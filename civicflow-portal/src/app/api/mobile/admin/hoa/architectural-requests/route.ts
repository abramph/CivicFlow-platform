import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileHoaPermission } from "@/lib/mobile-admin-hoa";
import { ValidationError } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { listArchitecturalRequests } from "@/lib/hoa/architectural-requests";

const REQUEST_STATUSES = [
  "DRAFT", "SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED", "RESUBMITTED",
  "APPROVED", "CONDITIONALLY_APPROVED", "DENIED", "WITHDRAWN", "EXPIRED",
] as const;

/**
 * GET /api/mobile/admin/hoa/architectural-requests?organizationId=...&propertyId=...&status=...
 *
 * Mobile Admin program (PR E) — HOA architectural requests, READ ONLY on
 * mobile (plus commenting, see [requestId]/comments/route.ts). Deciding an
 * architectural request (approve/conditionally-approve/deny) is explicitly
 * NOT exposed on mobile anywhere in this route tree — per the portal's own
 * documented design decision (docs/hoa-mobile-strategy.md: "board decision
 * ... a Never for mobile in the near term"). No route in this directory
 * ever imports transitionArchitecturalRequestStatus() or checks
 * HOA_ARCHITECTURAL_REQUESTS_DECIDE — that is the actual enforcement, not
 * just a missing button.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireMobileHoaPermission(request, organizationId, "manageHoaArchitecturalRequests", PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_READ);

    const statusParam = searchParams.get("status");
    const status = REQUEST_STATUSES.includes(statusParam as (typeof REQUEST_STATUSES)[number])
      ? (statusParam as (typeof REQUEST_STATUSES)[number])
      : undefined;

    const requests = await listArchitecturalRequests(organizationId, {
      propertyId: searchParams.get("propertyId") ?? undefined,
      status,
    });

    return Response.json({ ok: true, data: requests });
  });
}
