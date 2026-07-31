import type { OrganizationVertical, OrgStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectivePermissions } from "@/lib/role-permissions";
import { getOrganizationEntitlements, type OrganizationEntitlements } from "@/lib/plan-gate";
import { getVerticalTerminology, type VerticalTerminology } from "@/lib/vertical-terminology";
import type { Permission, Role } from "@/lib/rbac";

export class OrganizationNotFoundError extends Error {
  constructor(organizationId: string) {
    super(`Organization ${organizationId} not found`);
    this.name = "OrganizationNotFoundError";
  }
}

export interface OrganizationExperience {
  organizationId: string;
  organizationName: string;
  /** The authoritative product-experience classification — never derived
   * from anything the client sends; always read fresh from the Organization
   * row keyed by the server-resolved organizationId. */
  primaryVertical: OrganizationVertical;
  status: OrgStatus;
  role: Role;
  /** Effective permissions for the given role in this organization — same
   * source auth-guards.ts already uses, so this never drifts from what
   * requirePermission()/requireRole() actually enforce. */
  permissions: Permission[];
  entitlements: OrganizationEntitlements;
  /** Only ENABLED Lab feature keys — the technical feature-gates active for
   * this org, kept deliberately separate from primaryVertical (see enum doc
   * in schema.prisma). */
  enabledLabFeatures: string[];
  terminology: VerticalTerminology;
}

/**
 * The single authoritative source of "what can this org/user see and do
 * right now" — combining primary vertical, organization status, subscription
 * entitlements, Lab enrollments, and effective role/permissions. Every
 * vertical-aware surface (onboarding, navigation, dashboards, Platform Admin,
 * mobile capability responses) should read through this rather than
 * recombining these signals itself.
 *
 * organizationId and role must already be server-resolved (e.g. from
 * requireOrganization()/requirePermission()) — this function never accepts
 * or trusts a client-supplied vertical, organization name, or permission
 * list; it always re-derives them from the database.
 */
export async function resolveOrganizationExperience(params: {
  organizationId: string;
  role: Role;
}): Promise<OrganizationExperience> {
  const { organizationId, role } = params;

  const [org, labFeatures, permissions, entitlements] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, primaryVertical: true, status: true },
    }),
    prisma.organizationLabFeature.findMany({
      where: { organizationId, status: "ENABLED" },
      select: { featureKey: true },
    }),
    getEffectivePermissions(organizationId, role),
    getOrganizationEntitlements(organizationId),
  ]);

  if (!org) throw new OrganizationNotFoundError(organizationId);

  return {
    organizationId: org.id,
    organizationName: org.name,
    primaryVertical: org.primaryVertical,
    status: org.status,
    role,
    permissions,
    entitlements,
    enabledLabFeatures: labFeatures.map((f) => f.featureKey),
    terminology: getVerticalTerminology(org.primaryVertical),
  };
}
