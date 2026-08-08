import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { approvePaymentReport } from "@/lib/payment-report-mutations";

const bodySchema = z.object({
  note: z.union([z.string().trim().max(2000), z.literal(""), z.null()]).optional(),
});

/**
 * Approves a member-submitted payment report. MEMBERSHIP_DUES reports apply
 * to the member's oldest outstanding dues charge (if any) and record a
 * DuesPayment — unchanged behavior from before categories existed. Every
 * other category records a Contribution instead (reusing the existing
 * donation/fundraiser ledger), and never touches dues charges.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:payment-reports:review",
      request,
      limit: 60,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("dues:write", "throw");
    const { id } = await params;
    const { note } = await parseJsonBody(request, bodySchema);

    const result = await approvePaymentReport(organizationId, { userId: session.userId, userEmail: session.userEmail }, id, note);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data });
  });
}
