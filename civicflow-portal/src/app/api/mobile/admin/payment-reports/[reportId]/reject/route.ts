import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePaymentsPermission } from "@/lib/mobile-admin-payments";
import { PERMISSIONS } from "@/lib/rbac";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { rejectPaymentReport } from "@/lib/payment-report-mutations";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  rejectionReason: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:payment-reports:review",
      request,
      limit: 60,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, rejectionReason } = await parseJsonBody(request, bodySchema);
    const { userId, email } = await requireMobilePaymentsPermission(request, organizationId, "managePayments", PERMISSIONS.DUES_WRITE);
    const { reportId } = await params;

    const result = await rejectPaymentReport(organizationId, { userId, userEmail: email }, reportId, rejectionReason);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data });
  });
}
