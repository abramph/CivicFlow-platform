import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { rejectPaymentLinkOfflineReport } from "@/lib/payment-link-report-mutations";

const bodySchema = z.object({
  rejectionReason: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:payment-link-reports:review",
      request,
      limit: 60,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("payment_link_reports:review", "throw");
    const { id } = await params;
    const { rejectionReason } = await parseJsonBody(request, bodySchema);

    const result = await rejectPaymentLinkOfflineReport(organizationId, { userId: session.userId, userEmail: session.userEmail }, id, rejectionReason);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data });
  });
}
