import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePaymentsPermission } from "@/lib/mobile-admin-payments";
import { PERMISSIONS } from "@/lib/rbac";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { voidContribution, voidContributionSchema } from "@/lib/contribution-mutations";

const bodySchema = voidContributionSchema.extend({ organizationId: z.string().min(1) });

/** POST /api/mobile/admin/contributions/[contributionId]/void
 * Contribution is the only financial model in this codebase with a real,
 * tested void path -- never invent one for dues charges/payments. */
export async function POST(request: Request, { params }: { params: Promise<{ contributionId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:contributions:write",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, bodySchema);
    const { userId, email } = await requireMobilePaymentsPermission(request, organizationId, "managePayments", PERMISSIONS.CONTRIBUTIONS_WRITE);
    const { contributionId } = await params;

    const result = await voidContribution(organizationId, { userId, userEmail: email }, contributionId, input);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data });
  });
}
