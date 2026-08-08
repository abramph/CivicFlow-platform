import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { resolveMobileAdminCapabilities, type AdminCapabilityFlag } from "@/lib/mobile-admin";
import { getEffectivePermissions } from "@/lib/role-permissions";
import type { Permission, Role } from "@/lib/rbac";

/**
 * Shared two-gate guard for Mobile Admin Payments/Reports routes (PR D).
 *
 * Gate 1 (tab-visibility): the caller must hold the given adminCapabilities
 * flag (managePayments or manageReports), which already encodes Labs
 * enrollment + a real staff membership check via
 * resolveMobileAdminCapabilities().
 *
 * Gate 2 (per-operation permission): managePayments today maps only to
 * CONTRIBUTIONS_WRITE (src/lib/mobile-admin.ts) — NOT DUES_WRITE,
 * DUES_READ, PAYMENT_LINK_REPORTS_REVIEW, or RECEIPTS_WRITE. Since
 * FINANCE/ORG_ADMIN/STAFF/READ_ONLY permission sets are independently
 * org-customizable (OrgRolePermissionSet), holding managePayments never
 * implies holding any specific one of those. Every route must
 * independently re-check the EXACT permission its action actually needs,
 * exactly the way the web /api/dues/*, /api/contributions/*, and
 * /api/admin/payment-reports/* routes each call requirePermission() with
 * their own specific permission string rather than trusting one umbrella
 * flag. This function does both checks together so every payments/reports
 * mobile route enforces the identical two-gate pattern.
 */
export async function requireMobilePaymentsPermission(
  request: Request,
  organizationId: string,
  capabilityFlag: Extract<AdminCapabilityFlag, "managePayments" | "manageReports">,
  permission: Permission
) {
  const { userId, email } = await requireMobileAuth(request);
  const admin = await resolveMobileAdminCapabilities(organizationId, userId);
  if (!admin.available || !admin.adminCapabilities.includes(capabilityFlag) || !admin.role) {
    throw new MobileForbiddenError("No mobile payments/reports administration access for this organization");
  }

  const effective = await getEffectivePermissions(organizationId, admin.role as Role);
  if (!effective.includes(permission)) {
    throw new MobileForbiddenError(`Permission denied: ${permission}`);
  }

  return { userId, email, role: admin.role };
}
