import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePaymentsPermission } from "@/lib/mobile-admin-payments";
import { PERMISSIONS } from "@/lib/rbac";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { createDuesAdjustment, createDuesAdjustmentSchema } from "@/lib/dues-adjustments";

const bodySchema = createDuesAdjustmentSchema.extend({ organizationId: z.string().min(1) });

/**
 * POST /api/mobile/admin/dues/adjustments
 * Mirrors src/app/api/dues/adjustments/route.ts exactly.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:dues:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, bodySchema);
    const { userId, email } = await requireMobilePaymentsPermission(request, organizationId, "managePayments", PERMISSIONS.DUES_WRITE);

    const result = await createDuesAdjustment(organizationId, { userId, userEmail: email }, input);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data }, { status: 201 });
  });
}
