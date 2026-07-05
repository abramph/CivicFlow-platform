/**
 * Per-organization permission customization — lets an ORG_OWNER adjust
 * exactly what ORG_ADMIN/FINANCE/STAFF/READ_ONLY can do in their org
 * (e.g. relabel FINANCE as "Treasurer" and tighten/loosen its access),
 * instead of being stuck with the hardcoded defaults in rbac.ts.
 *
 * Hard safety rails, enforced here regardless of what's in the database:
 *   - SUPER_ADMIN and ORG_OWNER always have every permission.
 *   - MEMBER always has zero permissions (mobile members must never gain
 *     staff access — this is the exact invariant a prior security fix
 *     depends on; it must never become configurable).
 * Only the four roles in CUSTOMIZABLE_ROLES can have a database override.
 */
import { prisma } from "@/lib/prisma";
import { canDo, permissionsFor, PERMISSIONS, type Permission, type Role } from "@/lib/rbac";

export const CUSTOMIZABLE_ROLES = ["ORG_ADMIN", "FINANCE", "STAFF", "READ_ONLY"] as const;
export type CustomizableRole = (typeof CUSTOMIZABLE_ROLES)[number];

export function isCustomizableRole(role: string): role is CustomizableRole {
  return (CUSTOMIZABLE_ROLES as readonly string[]).includes(role);
}

// Platform-level permissions (cross-org, SUPER_ADMIN only) are excluded here —
// they're irrelevant within a single org's editor and are never granted via
// requireSuperAdmin()'s rank check anyway, only via canDo()/can().
const PLATFORM_ONLY_PERMISSIONS: Permission[] = [PERMISSIONS.ALL_ORGS_READ, PERMISSIONS.ALL_ORGS_MANAGE];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS).filter(
  (permission) => !PLATFORM_ONLY_PERMISSIONS.includes(permission)
);

/**
 * Resolves the actual permission set for a role in a specific org: the
 * org's override if one has been saved, otherwise the hardcoded default.
 */
export async function getEffectivePermissions(organizationId: string, role: Role): Promise<Permission[]> {
  if (role === "SUPER_ADMIN" || role === "ORG_OWNER") return permissionsFor(role);
  if (role === "MEMBER") return [];
  if (!isCustomizableRole(role)) return permissionsFor(role);

  const override = await prisma.orgRolePermissionSet.findUnique({
    where: { organizationId_role: { organizationId, role } },
  });
  if (override) return override.permissions as Permission[];
  return permissionsFor(role);
}

export async function canDoForOrg(organizationId: string, role: Role, permission: Permission): Promise<boolean> {
  if (role === "SUPER_ADMIN") return true;
  const effective = await getEffectivePermissions(organizationId, role);
  return effective.includes(permission);
}

/** The role's hardcoded default set, exposed for the editor UI to show what "Reset to default" restores. */
export function defaultPermissionsFor(role: CustomizableRole): Permission[] {
  return permissionsFor(role);
}

// Re-exported so callers of this module don't also need to import rbac.ts directly.
export { canDo };
