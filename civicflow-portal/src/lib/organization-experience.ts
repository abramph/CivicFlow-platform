import type { OrganizationVertical, OrgStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectivePermissions } from "@/lib/role-permissions";
import { getOrganizationEntitlements, type OrganizationEntitlements } from "@/lib/plan-gate";
import { getOrganizationLabAccess } from "@/lib/labs/access";
import {
  getVerticalTerminology,
  getQuickActions,
  getHelpTopics,
  type VerticalTerminology,
  type QuickAction,
  type HelpTopic,
} from "@/lib/vertical-terminology";
import { getNavigationProfile, getLandingRoute, type NavItem } from "@/lib/vertical-navigation";
import { roleRank, type Permission, type Role } from "@/lib/rbac";

/**
 * The vertical to actually build UI from, as distinct from the raw stored
 * classification. `Organization.primaryVertical` and PTA Labs enrollment are
 * deliberately separate concepts (see schema.prisma) — but PTA Labs
 * enrollment today has no self-service path at all (Platform Admin only,
 * `enrollmentSource: "operations_center"` in every real row). So an org that
 * is classified PTA but not yet enrolled would otherwise get PTA navigation
 * and a PTA dashboard redirect pointing at pages that all say "not available
 * for this organization" — a dead end. Falling back to COMMUNITY here until
 * enrollment catches up means nothing is ever broken; the moment Platform
 * Admin enables PTA Labs, the same org seamlessly gets the full PTA
 * experience with no further action. Platform Admin's own organization
 * pages read the raw stored column directly (getOrganizationDetail/
 * listOrganizations) and are unaffected by this fallback.
 */
export async function resolveEffectiveVertical(
  organizationId: string,
  primaryVertical: OrganizationVertical
): Promise<OrganizationVertical> {
  if (primaryVertical !== "PTA") return primaryVertical;
  const access = await getOrganizationLabAccess(organizationId, "ptaVertical");
  return access.available ? "PTA" : "COMMUNITY";
}

export class OrganizationNotFoundError extends Error {
  constructor(organizationId: string) {
    super(`Organization ${organizationId} not found`);
    this.name = "OrganizationNotFoundError";
  }
}

export interface OrganizationExperience {
  organizationId: string;
  organizationName: string;
  /** The EFFECTIVE product-experience classification — the raw stored
   * Organization.primaryVertical, reconciled with prerequisite Lab
   * enrollment via resolveEffectiveVertical (see its doc comment). Never
   * derived from anything the client sends; always read fresh from the
   * database by the server-resolved organizationId. */
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
  /** Already filtered by `permissions` above — a consuming page/component
   * never needs to re-apply permission logic to decide what to render. */
  navigation: NavItem[];
  quickActions: QuickAction[];
  helpTopics: HelpTopic[];
  /** The route a user should land on after selecting/switching into this org. */
  landingPage: string;
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

  const effectiveVertical = await resolveEffectiveVertical(organizationId, org.primaryVertical);

  const navigation = getNavigationProfile(effectiveVertical).filter((item) => {
    if (item.permission && !permissions.includes(item.permission)) return false;
    if (item.minRole && roleRank(role) < roleRank(item.minRole)) return false;
    return true;
  });

  return {
    organizationId: org.id,
    organizationName: org.name,
    primaryVertical: effectiveVertical,
    status: org.status,
    role,
    permissions,
    entitlements,
    enabledLabFeatures: labFeatures.map((f) => f.featureKey),
    terminology: getVerticalTerminology(effectiveVertical),
    navigation,
    quickActions: getQuickActions(effectiveVertical),
    helpTopics: getHelpTopics(effectiveVertical),
    landingPage: getLandingRoute(effectiveVertical),
  };
}
