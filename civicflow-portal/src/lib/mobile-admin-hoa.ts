import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { resolveMobileAdminCapabilities, type AdminCapabilityFlag } from "@/lib/mobile-admin";
import { getEffectivePermissions } from "@/lib/role-permissions";
import { assertOrganizationAccess } from "@/lib/subscription-gate";
import type { Permission, Role } from "@/lib/rbac";

/**
 * Shared two-gate guard for Mobile Admin HOA routes (PR E: Properties,
 * Violations, Architectural Requests).
 *
 * Gate 1 (tab-visibility): the caller must hold the given capability flag
 * (manageHoaProperties/manageHoaViolations/manageHoaArchitecturalRequests),
 * which already encodes Labs enrollment + a real staff membership + HOA
 * vertical check via resolveMobileAdminCapabilities(). There is no separate
 * manageHoaResidents flag — resident sub-resource screens reuse
 * manageHoaProperties for tab-visibility (mirrors the web's own properties+
 * residents pairing), same as PR D's dashboard reusing managePayments for
 * both dues and contributions tab-visibility.
 *
 * Gate 2 (per-operation permission): each capability flag maps to only ONE
 * specific *_WRITE permission (see mobile-admin.ts's FLAG_RULES) — never
 * assumed to imply HOA_RESIDENTS_READ/WRITE, HOA_VIOLATIONS_REVIEW/RESOLVE,
 * or HOA_ARCHITECTURAL_REQUESTS_REVIEW, all of which are independently
 * org-customizable via OrgRolePermissionSet. Every route re-checks the
 * EXACT permission its action needs, matching the web /api/hoa/* routes'
 * own per-route guards (requireHoaPropertyWrite, requireHoaViolationResolve,
 * requireArchitecturalRequestReview, etc.) rather than trusting one
 * umbrella flag. This is also THE enforcement mechanism for architectural
 * requests being read+comment-only on mobile: no mobile route ever checks
 * HOA_ARCHITECTURAL_REQUESTS_DECIDE, so there is no code path that could
 * call transitionArchitecturalRequestStatus() for a terminal decision from
 * this client, regardless of what any future UI might try to render.
 */
export async function requireMobileHoaPermission(
  request: Request,
  organizationId: string,
  capabilityFlag: Extract<AdminCapabilityFlag, "manageHoaProperties" | "manageHoaViolations" | "manageHoaArchitecturalRequests">,
  permission: Permission
) {
  const { userId, email } = await requireMobileAuth(request);
  const admin = await resolveMobileAdminCapabilities(organizationId, userId);
  if (!admin.available || !admin.adminCapabilities.includes(capabilityFlag) || !admin.role) {
    throw new MobileForbiddenError("No mobile HOA administration access for this organization");
  }

  await assertOrganizationAccess(organizationId);

  const effective = await getEffectivePermissions(organizationId, admin.role as Role);
  if (!effective.includes(permission)) {
    throw new MobileForbiddenError(`Permission denied: ${permission}`);
  }

  return { userId, email, role: admin.role };
}
