import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { resolveMobileAdminCapabilities } from "@/lib/mobile-admin";
import { getEffectivePermissions } from "@/lib/role-permissions";
import type { Permission, Role } from "@/lib/rbac";

/**
 * Shared two-gate guard for Mobile Admin PTA Households routes (PR E).
 *
 * Gate 1 (tab-visibility): the caller must hold managePtaHouseholds, which
 * already encodes Labs enrollment + a real staff membership + PTA vertical
 * check via resolveMobileAdminCapabilities().
 *
 * Gate 2 (per-operation permission): managePtaHouseholds maps only to
 * PTA_HOUSEHOLDS_MANAGE (src/lib/mobile-admin.ts) — NOT PTA_STUDENTS_MANAGE
 * or PTA_DIRECTORY_READ, which are independently org-customizable via
 * OrgRolePermissionSet. Every route must re-check the EXACT permission its
 * action needs, matching the web /api/labs/pta/households/* routes' own
 * per-route requirePtaAccess(permission) calls, rather than trusting the
 * umbrella flag to imply every PTA permission.
 */
export async function requireMobilePtaHouseholdsPermission(request: Request, organizationId: string, permission: Permission) {
  const { userId, email } = await requireMobileAuth(request);
  const admin = await resolveMobileAdminCapabilities(organizationId, userId);
  if (!admin.available || !admin.adminCapabilities.includes("managePtaHouseholds") || !admin.role) {
    throw new MobileForbiddenError("No mobile PTA household administration access for this organization");
  }

  const effective = await getEffectivePermissions(organizationId, admin.role as Role);
  if (!effective.includes(permission)) {
    throw new MobileForbiddenError(`Permission denied: ${permission}`);
  }

  return { userId, email, role: admin.role };
}
