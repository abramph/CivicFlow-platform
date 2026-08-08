import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";
import { requireMobilePaymentsPermission } from "@/lib/mobile-admin-payments";
import { PERMISSIONS } from "@/lib/rbac";
import { ValidationError } from "@/lib/validation";
import type { PaymentReportStatus } from "@prisma/client";

const VALID_STATUSES: PaymentReportStatus[] = ["pending", "approved", "rejected"];

/** GET /api/mobile/admin/payment-reports?organizationId=...&status=pending */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireMobilePaymentsPermission(request, organizationId, "managePayments", PERMISSIONS.DUES_READ);

    const statusParam = searchParams.get("status");
    const status = VALID_STATUSES.includes(statusParam as PaymentReportStatus) ? (statusParam as PaymentReportStatus) : "pending";

    const rows = await prisma.paymentReport.findMany({
      where: { organizationId, status },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        amount: true,
        paymentMethod: true,
        paymentDate: true,
        category: true,
        status: true,
        rejectionReason: true,
        createdAt: true,
        member: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return Response.json({ ok: true, data: rows });
  });
}
