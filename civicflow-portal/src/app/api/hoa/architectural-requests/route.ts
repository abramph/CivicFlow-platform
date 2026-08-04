import { withApiErrorHandling } from "@/lib/api-route";
import { requireArchitecturalRequestRead } from "@/lib/hoa/architectural-requests-guard";
import { listArchitecturalRequests } from "@/lib/hoa/architectural-requests";

const STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "RESUBMITTED",
  "APPROVED",
  "CONDITIONALLY_APPROVED",
  "DENIED",
  "WITHDRAWN",
  "EXPIRED",
] as const;

/** Officer directory -- creation is resident-initiated only (see
 * .../my/route.ts POST), so there is no officer-facing POST here. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireArchitecturalRequestRead();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const propertyId = url.searchParams.get("propertyId");
    const requests = await listArchitecturalRequests(organizationId, {
      status: STATUSES.includes(status as (typeof STATUSES)[number]) ? (status as (typeof STATUSES)[number]) : undefined,
      propertyId: propertyId ?? undefined,
    });
    return Response.json({ ok: true, data: requests });
  });
}
