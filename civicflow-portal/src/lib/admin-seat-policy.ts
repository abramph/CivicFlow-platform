/**
 * Unestra Cloud — Administrative Seat Policy (CLOUD-SEAT-A)
 *
 * The single, centralized answer to "does holding this permission set consume
 * one of an organization's included administrative seats." Every seat
 * calculation and enforcement point (CLOUD-SEAT-B/C) must route through this
 * module — never re-derive the classification by role name or duplicate the
 * permission list elsewhere. See docs/admin-seat-capability-audit.md for the
 * full audit and the reasoning behind every permission's classification.
 *
 * The rule: a permission consumes a seat unless it's already part of
 * READ_ONLY's own default bundle (pure read/view access, the platform's own
 * pre-existing definition of "viewing without editing rights"). Classifying
 * by effective, resolved permissions rather than role label means a custom
 * OrgRolePermissionSet-trimmed role that ends up with only read access never
 * consumes a seat, regardless of what it's labeled.
 */
import { permissionsFor, type Permission, type Role } from "@/lib/rbac";
import { getEffectivePermissions } from "@/lib/role-permissions";

/** READ_ONLY's own default bundle — the seat-exempt baseline. Derived from
 * rbac.ts, never hand-duplicated, so it can never drift out of sync with the
 * platform's own definition of "read-only access." */
const NON_SEAT_PERMISSIONS: ReadonlySet<Permission> = new Set(permissionsFor("READ_ONLY"));

/**
 * True if holding this exact set of effective permissions represents
 * material organization-management authority — i.e. consumes one
 * administrative seat. A permission set with zero entries outside
 * READ_ONLY's bundle (including an empty set, e.g. MEMBER) never consumes a
 * seat.
 */
export function requiresAdministrativeSeat(effectivePermissions: readonly Permission[]): boolean {
  return effectivePermissions.some((permission) => !NON_SEAT_PERMISSIONS.has(permission));
}

/**
 * Convenience wrapper for the common case: given an org and a role, resolve
 * that role's actual effective permissions in this specific org (honoring
 * any OrgRolePermissionSet customization) and answer whether it consumes an
 * administrative seat. MEMBER short-circuits to false without a query, since
 * getEffectivePermissions() already guarantees it resolves to zero
 * permissions — this just avoids the round trip for the platform's most
 * common role.
 */
export async function roleRequiresAdministrativeSeat(organizationId: string, role: Role): Promise<boolean> {
  if (role === "MEMBER") return false;
  const effective = await getEffectivePermissions(organizationId, role);
  return requiresAdministrativeSeat(effective);
}
