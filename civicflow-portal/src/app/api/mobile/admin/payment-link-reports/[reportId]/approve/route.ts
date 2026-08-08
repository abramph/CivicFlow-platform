import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePaymentsPermission } from "@/lib/mobile-admin-payments";
import { PERMISSIONS } from "@/lib/rbac";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { approvePaymentLinkOfflineReport } from "@/lib/payment-link-report-mutations";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  note: z.union([z.string().trim().max(2000), z.literal(""), z.null()]).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:payment-link-reports:review",
      request,
      limit: 60,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, note } = await parseJsonBody(request, bodySchema);
    const { userId, email } = await requireMobilePaymentsPermission(request, organizationId, "managePayments", PERMISSIONS.PAYMENT_LINK_REPORTS_REVIEW);
    const { reportId } = await params;

    const result = await approvePaymentLinkOfflineReport(organizationId, { userId, userEmail: email }, reportId, note);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data });
  });
}
