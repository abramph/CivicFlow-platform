import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireOrganizationLabFeature } from "@/lib/labs/access";
import { recordLabUsage } from "@/lib/labs/usage";

/**
 * Records one trivial, non-sensitive usage event for the internal-only
 * labsFrameworkPreview feature — proves the enrollment guard and the usage
 * interface both work end to end. Never records anything but a static
 * action label and a count; no content of any kind.
 */
export async function POST() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("labs:read", "throw");
    await requireOrganizationLabFeature(organizationId, "labsFrameworkPreview");

    await recordLabUsage({
      organizationId,
      featureKey: "labsFrameworkPreview",
      unit: "automation_executions",
      quantity: 1,
      metadata: { action: "preview_panel_viewed" },
    });

    return Response.json({ ok: true });
  });
}
