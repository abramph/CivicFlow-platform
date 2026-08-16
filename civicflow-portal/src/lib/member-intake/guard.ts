import { requirePermission } from "@/lib/auth-guards";
import { getOrganizationLabAccess } from "@/lib/labs/access";
import type { Permission } from "@/lib/rbac";

/**
 * Member Intake & Profile Update (MEMBER-QR-B) — the non-throwing page gate
 * for admin UI pages (mirrors getPtaPageGate's shape): a page needs to keep
 * rendering its own "not available" message rather than letting an error
 * blow up the whole route, unlike an API route which can just throw (see
 * requireMemberIntakeView/Manage/etc. in forms.ts, used there instead).
 */
export async function getMemberIntakePageGate(permission: Permission) {
  const { organizationId, session, role, can } = await requirePermission(permission);
  const access = await getOrganizationLabAccess(organizationId, "memberIntake");
  return { organizationId, session, role, can, access };
}
