/**
 * Per-organization permission customization — lets an ORG_OWNER adjust
 * exactly what ORG_ADMIN/FINANCE/STAFF/READ_ONLY can do in their org
 * (e.g. relabel FINANCE as "Treasurer" and tighten/loosen its access),
 * instead of being stuck with the hardcoded defaults in rbac.ts.
 *
 * Hard safety rails, enforced here regardless of what's in the database:
 *   - SUPER_ADMIN and ORG_OWNER always have every (org-scoped) permission —
 *     the two are functionally identical here; SUPER_ADMIN carries no
 *     platform-wide reach through this module (see rbac.ts).
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

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

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
  const effective = await getEffectivePermissions(organizationId, role);
  return effective.includes(permission);
}

/**
 * Resolves whether a specific user CURRENTLY holds a permission in an org,
 * from just (organizationId, userId) — no live session/request required.
 * For a background job (the report-export worker) that only has
 * `ReportExport.createdByUserId` to go on, re-deriving from the DB at
 * processing time (rather than trusting a permission decision snapshotted
 * at enqueue time) matches this same file/queue's existing convention of
 * re-checking capability flags "not just at enqueue time" — a role change
 * between enqueue and processing must take effect immediately, the same way
 * a flag change does.
 *
 * Fails closed (false) if the user has no active membership in the org —
 * an export whose creator can no longer be resolved to a real member must
 * never be treated as having elevated access.
 */
export async function hasCurrentPermissionForOrg(organizationId: string, userId: string, permission: Permission): Promise<boolean> {
  if (!userId) return false;
  const membership = await prisma.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true, status: true },
  });
  if (!membership || membership.status !== "active") return false;
  return canDoForOrg(organizationId, membership.role, permission);
}

/** The role's hardcoded default set, exposed for the editor UI to show what "Reset to default" restores. */
export function defaultPermissionsFor(role: CustomizableRole): Permission[] {
  return permissionsFor(role);
}

// Re-exported so callers of this module don't also need to import rbac.ts directly.
export { canDo };
