import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { getAccountView } from "@/lib/payments/stripe-connect";

/** CONNECT-B (§24) — connection status for the settings surface. Null data
 * = never connected. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("payments:stripe:view", "throw");
    const view = await getAccountView(organizationId);
    return Response.json({ ok: true, data: view });
  });
}
