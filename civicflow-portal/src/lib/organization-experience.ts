import type { OrganizationVertical, OrgStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectivePermissions } from "@/lib/role-permissions";
import { getOrganizationEntitlements, type OrganizationEntitlements } from "@/lib/plan-gate";
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
 * `Organization.primaryVertical` alone is authoritative for the product
 * experience — as of PR #40 (PTA/PTO graduated from a Labs-gated pilot to a
 * first-class vertical; see docs/pta-access-architecture.md), there is no
 * reconciliation against Labs enrollment. This function is kept (rather
 * than inlined at every call site) purely so existing callers — which were
 * all written expecting an async reconciliation step — don't need to
 * change, and as the one place a future genuine reconciliation need would
 * go. `primaryVertical = PTA` now means the PTA experience immediately,
 * with no separate enrollment step and no silent fallback to COMMUNITY.
 */
export async function resolveEffectiveVertical(
  _organizationId: string,
  primaryVertical: OrganizationVertical
): Promise<OrganizationVertical> {
  return primaryVertical;
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
  /** The product-experience classification — the raw stored
   * Organization.primaryVertical (as of PR #40, authoritative on its own;
   * see resolveEffectiveVertical's doc comment). Never derived from
   * anything the client sends; always read fresh from the database by the
   * server-resolved organizationId. */
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
