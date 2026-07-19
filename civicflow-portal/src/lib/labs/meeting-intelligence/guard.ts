import { requirePermission } from "@/lib/auth-guards";
import { requireOrganizationLabFeature } from "@/lib/labs/access";
import type { Permission } from "@/lib/rbac";

/**
 * The composed guard every Meeting Intelligence route must call first:
 * tenant RBAC permission (organization-scoped, session-resolved) AND Labs
 * organization access (entitlement + enrollment + internal-only ceiling).
 * Matches Phase 11's requirement that the backend independently enforces
 * every layer — feature-exists is implicit (the registry lookup inside
 * requireOrganizationLabFeature throws LAB_FEATURE_UNKNOWN if it somehow
 * didn't), entitlement + enrollment come from requireOrganizationLabFeature,
 * and user permission comes from requirePermission.
 */
export async function requireMeetingIntelligenceAccess(permission: Permission) {
  const { organizationId, session, role } = await requirePermission(permission, "throw");
  await requireOrganizationLabFeature(organizationId, "meetingIntelligence");
  return { organizationId, session, role };
}
