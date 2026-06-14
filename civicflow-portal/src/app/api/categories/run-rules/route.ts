import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { applyMembershipCategoryRulesForOrganization } from "@/lib/membership-rules";

export async function POST() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("org_settings:write", "throw");

    const result = await applyMembershipCategoryRulesForOrganization(organizationId);

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "run_rules",
      entityType: "membership_category_rules",
      metadata: result,
    });

    return Response.json({ ok: true, data: result });
  });
}

