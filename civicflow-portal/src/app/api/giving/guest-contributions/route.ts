import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { ensureContributionsEnabled } from "@/lib/giving/module";
import { listGuestContributions } from "@/lib/giving/public-giving";

/** CORE-GIVE-J (§57) — guest rows + match suggestions. Individual-giving
 * visibility territory. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("contributions:individual:view", "throw");
    await ensureContributionsEnabled(organizationId);
    const rows = await listGuestContributions(organizationId);
    return Response.json({ ok: true, data: rows });
  });
}
