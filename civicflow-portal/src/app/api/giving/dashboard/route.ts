import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { getFinanceDashboard } from "@/lib/giving/finance-dashboard";

/** CORE-GIVE-I (§37) — org-level giving aggregates for finance roles.
 * Aggregates only; individual giving stays behind its own capability. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("contributions:summary:view", "throw");
    const dashboard = await getFinanceDashboard(organizationId);
    return Response.json({ ok: true, data: dashboard });
  });
}
