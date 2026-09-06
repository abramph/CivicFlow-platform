import { withApiErrorHandling } from "@/lib/api-route";
import { listFamilyChangeRequests } from "@/lib/labs/pta/family-change-requests";
import { requireMobilePtaHouseholdsPermission } from "@/lib/mobile-admin-pta";
import { PERMISSIONS } from "@/lib/rbac";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/admin/pta/change-requests?organizationId=...&status=...
 *
 * Build 27 — the officer review queue for parent-submitted family change
 * requests. Same two-gate guard as every household admin route
 * (managePtaHouseholds capability + the exact PTA_HOUSEHOLDS_MANAGE
 * permission); oldest first, so the queue is worked in submission order.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");
    const statusParam = searchParams.get("status");
    const status = statusParam && ["SUBMITTED", "APPROVED", "APPLIED", "REJECTED"].includes(statusParam)
      ? (statusParam as "SUBMITTED" | "APPROVED" | "APPLIED" | "REJECTED")
      : undefined;

    await requireMobilePtaHouseholdsPermission(request, organizationId, PERMISSIONS.PTA_HOUSEHOLDS_MANAGE);

    const rows = await listFamilyChangeRequests(organizationId, { status });
    return Response.json({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        householdId: row.householdId,
        householdName: row.household.displayName,
        type: row.type,
        payload: row.payload,
        status: row.status,
        decisionNotes: row.decisionNotes,
        createdAt: row.createdAt,
        reviewedAt: row.reviewedAt,
        appliedAt: row.appliedAt,
      })),
    });
  });
}
