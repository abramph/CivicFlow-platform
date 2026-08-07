/**
 * Unestra Mobile Administration Platform — PR A
 *
 * Resolves the server-authoritative set of admin capabilities a caller
 * holds for one organization, for the mobile client's Admin tab and
 * dashboard. Two independent gates, both required:
 *
 *  1. The organization must be enrolled in the "mobileAdmin" Labs feature
 *     (see src/lib/labs/registry.ts) — the program's staged-rollout
 *     mechanism (INTERNAL -> ALPHA -> BETA -> PREVIEW -> GENERAL_AVAILABILITY,
 *     see docs/mobile-admin-rollout.md). This is checked first and is the
 *     cheap fast path: the overwhelming majority of organizations are not
 *     enrolled yet, so no permission computation happens for them at all.
 *  2. The caller must hold a real, org-customizable RBAC permission (via
 *     getEffectivePermissions(), the same resolver the web portal and the
 *     existing PTA mobile guards already use) that maps to each capability
 *     flag below.
 *
 * Never derive capabilities from a role name alone, and never trust a
 * capability set supplied by the mobile client — this function is the sole
 * source of truth, called fresh on every request that needs it.
 */
import { prisma } from "@/lib/prisma";
import { getEffectivePermissions } from "@/lib/role-permissions";
import { getOrganizationLabAccess } from "@/lib/labs/access";
import { getVerticalCapabilities, type CapabilityFlag } from "@/lib/vertical-capabilities";
import { PERMISSIONS, type Permission, type Role } from "@/lib/rbac";
import type { OrganizationVertical } from "@prisma/client";

export const MOBILE_ADMIN_LABS_FEATURE_KEY = "mobileAdmin";

export const ADMIN_CAPABILITY_FLAGS = [
  "adminDashboard",
  "manageMembers",
  "manageEvents",
  "manageAttendance",
  "manageCommunications",
  "managePayments",
  "manageReports",
  "manageOrganization",
  "managePtaHouseholds",
  "managePtaVolunteers",
  "manageHoaProperties",
  "manageHoaViolations",
  "manageHoaArchitecturalRequests",
  "manageUnionPayrollCheckoff",
] as const;

export type AdminCapabilityFlag = (typeof ADMIN_CAPABILITY_FLAGS)[number];

export interface MobileAdminCapabilityResult {
  /** Whether the caller has ANY admin capability for this org — the single boolean the Admin tab's visibility gates on. */
  available: boolean;
  /** The caller's staff role for this org, or null if they hold no staff membership / the org isn't enrolled. */
  role: string | null;
  /** Only the flags the caller actually holds — never the full enum, so the client can iterate this directly without an `?? false` fallback. */
  adminCapabilities: AdminCapabilityFlag[];
}

const EMPTY_RESULT: MobileAdminCapabilityResult = { available: false, role: null, adminCapabilities: [] };

/**
 * permission: the RBAC permission that grants this flag.
 * vertical: if set, the flag also requires the org's effective vertical to
 * match — a permission string alone is not trusted to imply its vertical
 * (defense in depth; getEffectivePermissions() should already never return
 * a vertical-specific permission for the wrong vertical, but this function
 * does not assume that).
 * capabilityFlag: if set, additionally requires getVerticalCapabilities()
 * to have this flag on (e.g. HOA Architectural Requests is a distinct
 * rollout from HOA Properties, even though both are HOA-only).
 */
const FLAG_RULES: Record<
  Exclude<AdminCapabilityFlag, "adminDashboard">,
  { permission: Permission; vertical?: OrganizationVertical; capabilityFlag?: CapabilityFlag }
> = {
  manageMembers: { permission: PERMISSIONS.MEMBERS_WRITE },
  manageEvents: { permission: PERMISSIONS.EVENTS_WRITE },
  manageAttendance: { permission: PERMISSIONS.ATTENDANCE_WRITE },
  manageCommunications: { permission: PERMISSIONS.COMMUNICATIONS_WRITE },
  managePayments: { permission: PERMISSIONS.CONTRIBUTIONS_WRITE },
  manageReports: { permission: PERMISSIONS.REPORTS_READ },
  manageOrganization: { permission: PERMISSIONS.ORG_SETTINGS_WRITE },
  managePtaHouseholds: { permission: PERMISSIONS.PTA_HOUSEHOLDS_MANAGE, vertical: "PTA" },
  managePtaVolunteers: { permission: PERMISSIONS.PTA_VOLUNTEERS_MANAGE, vertical: "PTA" },
  manageHoaProperties: { permission: PERMISSIONS.HOA_PROPERTIES_WRITE, vertical: "HOA" },
  manageHoaViolations: { permission: PERMISSIONS.HOA_VIOLATIONS_WRITE, vertical: "HOA" },
  manageHoaArchitecturalRequests: { permission: PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_WRITE, vertical: "HOA", capabilityFlag: "architecturalRequests" },
  // Union payroll checkoff has no dedicated permission — it runs entirely
  // through the generic PaymentImportBatch/imports:* pipeline (see
  // src/lib/vertical-import.ts and docs/import-architecture.md), not a
  // union:*-namespaced permission.
  manageUnionPayrollCheckoff: { permission: PERMISSIONS.IMPORTS_CREATE, vertical: "UNION" },
};

export async function resolveMobileAdminCapabilities(
  organizationId: string,
  userId: string
): Promise<MobileAdminCapabilityResult> {
  const labAccess = await getOrganizationLabAccess(organizationId, MOBILE_ADMIN_LABS_FEATURE_KEY);
  if (!labAccess.available) return EMPTY_RESULT;

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId, organizationId, status: "active", organization: { status: "active" }, role: { not: "MEMBER" } },
    select: { role: true },
  });
  if (!membership) return EMPTY_RESULT;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { primaryVertical: true },
  });
  if (!organization) return EMPTY_RESULT;

  const effective = await getEffectivePermissions(organizationId, membership.role as Role);
  const verticalCapabilities = getVerticalCapabilities(organization.primaryVertical);

  const adminCapabilities: AdminCapabilityFlag[] = [];
  for (const flag of ADMIN_CAPABILITY_FLAGS) {
    if (flag === "adminDashboard") continue;
    const rule = FLAG_RULES[flag];
    if (!effective.includes(rule.permission)) continue;
    if (rule.vertical && organization.primaryVertical !== rule.vertical) continue;
    if (rule.capabilityFlag && !verticalCapabilities[rule.capabilityFlag]) continue;
    adminCapabilities.push(flag);
  }

  if (adminCapabilities.length > 0) adminCapabilities.unshift("adminDashboard");

  return {
    available: adminCapabilities.length > 0,
    role: membership.role,
    adminCapabilities,
  };
}
