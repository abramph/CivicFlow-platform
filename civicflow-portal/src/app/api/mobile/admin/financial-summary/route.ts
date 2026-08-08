import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";
import { requireMobilePaymentsPermission } from "@/lib/mobile-admin-payments";
import { getMemberPaymentsFinancialSummary } from "@/lib/financial-summary";
import { PERMISSIONS } from "@/lib/rbac";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/admin/financial-summary?organizationId=...
 * Read-only Payments admin landing summary. Uses the exact same safe
 * (DB-aggregate, integer-cents) technique as the main org dashboard --
 * never the float-summing GENERAL_FINANCIAL report technique.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireMobilePaymentsPermission(request, organizationId, "managePayments", PERMISSIONS.DUES_READ);

    const [summary, pendingPaymentReports, pendingPaymentLinkReports] = await Promise.all([
      getMemberPaymentsFinancialSummary(organizationId),
      prisma.paymentReport.count({ where: { organizationId, status: "pending" } }),
      prisma.paymentLinkOfflineReport.count({ where: { organizationId, status: "pending" } }),
    ]);

    return Response.json({
      ok: true,
      data: { ...summary, pendingPaymentReports, pendingPaymentLinkReports },
    });
  });
}
