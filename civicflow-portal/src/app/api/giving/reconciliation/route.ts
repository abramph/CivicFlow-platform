import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { ensureContributionsEnabled } from "@/lib/giving/module";
import { getReconciliationReport } from "@/lib/giving/reconciliation";

/** CORE-GIVE-F — the §51 reconciliation view. Read-only; requires
 * contributions:reconciliation:view; nothing is auto-corrected. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("contributions:reconciliation:view", "throw");
    await ensureContributionsEnabled(organizationId);
    const report = await getReconciliationReport(organizationId);
    return Response.json({ ok: true, data: report });
  });
}
