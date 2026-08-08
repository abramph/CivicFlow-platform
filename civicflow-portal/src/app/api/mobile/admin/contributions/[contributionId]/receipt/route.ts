import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePaymentsPermission } from "@/lib/mobile-admin-payments";
import { PERMISSIONS } from "@/lib/rbac";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { createReceiptForContribution } from "@/lib/receipt-mutations";

const bodySchema = z.object({ organizationId: z.string().min(1) });

/** POST /api/mobile/admin/contributions/[contributionId]/receipt
 * Mirrors src/app/api/receipts/route.ts -- idempotent per contribution. */
export async function POST(request: Request, { params }: { params: Promise<{ contributionId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:receipts:write",
      request,
      limit: 40,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId } = await parseJsonBody(request, bodySchema);
    const { userId, email } = await requireMobilePaymentsPermission(request, organizationId, "managePayments", PERMISSIONS.RECEIPTS_WRITE);
    const { contributionId } = await params;

    const result = await createReceiptForContribution(organizationId, { userId, userEmail: email }, { contributionId });
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data, ...(result.existing ? { existing: true } : {}) }, { status: result.existing ? 200 : 201 });
  });
}
