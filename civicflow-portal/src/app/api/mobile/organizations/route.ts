import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth } from "@/lib/mobile-auth";
import { getEffectivePermissions } from "@/lib/role-permissions";
import { resolveEffectiveVertical } from "@/lib/organization-experience";
import { getVerticalTerminology, getQuickActions } from "@/lib/vertical-terminology";
import { getVerticalCapabilities } from "@/lib/vertical-capabilities";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS, type Role } from "@/lib/rbac";
import type { OrganizationVertical } from "@prisma/client";

interface OrgRow {
  organizationId: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  memberId: string | null;
  firstName: string | null;
  lastName: string | null;
  membershipStatus: string | null;
  isDelinquent: boolean;
  pta: {
    householdAdultId: string | null;
    householdName: string | null;
    isOfficer: boolean;
    canCheckIn: boolean;
    canApproveHours: boolean;
  } | null;
}

/**
 * Additive capability fields (Phase 10 of the vertical-product architecture
 * work) — old mobile app builds that don't know these fields exist simply
 * ignore them; nothing here changes existing behavior (the "Volunteer" tab,
 * for instance, still keys off `pta` truthiness exactly as before). This
 * prepares a future mobile release to adapt tab labels/quick actions/landing
 * tab per vertical without another schema or endpoint change.
 */
interface OrgCapability {
  primaryVertical: OrganizationVertical;
  terminology: {
    productLabel: string;
    member: string;
    dashboardTitle: string;
  };
  quickActions: { href: string; label: string }[];
  /** Which of the mobile app's fixed tabs are meaningful for this org. */
  supportedModules: string[];
  /** Tab name (not a web path) the app should land on after selecting this org. */
  landingPage: string;
  /** PR #43 -- additive per-vertical feature flags (see
   * src/lib/vertical-capabilities.ts). Officer-only property/resident DATA
   * is never exposed through this general-purpose endpoint, only the
   * boolean "does this org have this feature" signal — a future mobile
   * release consuming actual property records would go through a
   * separately-guarded endpoint, not this one. Old mobile builds that
   * don't know this field exists simply ignore it. */
  capabilities: {
    properties: boolean;
    propertyResidents: boolean;
  };
}

/** `vertical` must already be the effective vertical (see
 * resolveEffectiveVertical) — resolved once per row by the caller, which
 * knows whether that check is even necessary (rows already confirmed PTA by
 * branches 2/3 below don't need a second Labs-access check). */
function buildCapability(vertical: OrganizationVertical, hasPtaAccess: boolean) {
  const terminology = getVerticalTerminology(vertical);
  const supportedModules = ["dashboard", "inbox", "announcements", "dues", "events", "profile"];
  if (hasPtaAccess) supportedModules.push("volunteers");
  const verticalCapabilities = getVerticalCapabilities(vertical);
  return {
    primaryVertical: vertical,
    terminology: { productLabel: terminology.productLabel, member: terminology.member, dashboardTitle: terminology.dashboardTitle },
    quickActions: getQuickActions(vertical),
    supportedModules,
    landingPage: "dashboard",
    capabilities: {
      properties: verticalCapabilities.properties,
      propertyResidents: verticalCapabilities.propertyResidents,
    },
  };
}

/**
 * Lists every organization the caller can meaningfully open in the mobile
 * app — three independent identities, merged by organizationId (a caller
 * can hold more than one, e.g. a PTA president who is also a household
 * adult in their own PTA):
 *
 *  1. A regular MEMBER-role OrganizationMembership + linked OrgMember (the
 *     original, pre-PTA behavior — untouched).
 *  2. A PtaHouseholdAdult.userId link. PTA parents deliberately have NO
 *     OrganizationMembership at all (the household's one shared OrgMember
 *     is a billing identity, not a per-adult one — see mobile-auth.ts), so
 *     without this branch every PTA parent would see a permanently empty
 *     org-switcher after logging in, unable to reach any screen.
 *  3. A staff-role OrganizationMembership that actually holds
 *     pta:volunteers:checkin or pta:volunteer-hours:approve in a
 *     PTA-enrolled org — the limited officer mobile workflow's entry point.
 *     Deliberately NOT "any staff role in any org" — an officer with no PTA
 *     permission at all has nothing to do in this app yet (officer admin
 *     stays web-first), so surfacing them here would be a dead end.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { userId } = await requireMobileAuth(request);

    const rows = new Map<string, OrgRow>();
    // Raw (stored) vertical per org — branches 2/3 only ever include orgs
    // with confirmed-enabled PTA Labs, so they're definitionally "PTA" here;
    // branch 1 (regular members) can be any vertical.
    const rawVerticalByOrgId = new Map<string, OrganizationVertical>();
    // orgIds where branches 2/3 already confirmed PTA Labs is enabled — no
    // need to ask resolveEffectiveVertical to check again for these.
    const confirmedPtaOrgIds = new Set<string>();

    // ── 1. Regular members (unchanged) ──────────────────────────────────
    const memberships = await prisma.organizationMembership.findMany({
      where: { userId, role: "MEMBER", organization: { status: "active" } },
      orderBy: { joinedAt: "asc" },
      include: { organization: { select: { id: true, name: true, logoUrl: true, primaryVertical: true } } },
    });
    const members = await prisma.orgMember.findMany({
      where: { userId, organizationId: { in: memberships.map((m) => m.organizationId) } },
      select: { id: true, organizationId: true, firstName: true, lastName: true, membershipStatus: true, isDelinquent: true },
    });
    const memberByOrgId = new Map(members.map((m) => [m.organizationId, m]));
    for (const membership of memberships) {
      const member = memberByOrgId.get(membership.organizationId);
      if (!member) continue;
      rawVerticalByOrgId.set(membership.organizationId, membership.organization.primaryVertical);
      rows.set(membership.organizationId, {
        organizationId: membership.organizationId,
        organizationName: membership.organization.name,
        organizationLogoUrl: membership.organization.logoUrl,
        memberId: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        membershipStatus: member.membershipStatus,
        isDelinquent: member.isDelinquent,
        pta: null,
      });
    }

    // ── 2. PTA household adults ──────────────────────────────────────────
    const householdAdults = await prisma.ptaHouseholdAdult.findMany({
      where: { userId, organization: { status: "active" }, household: { status: "ACTIVE" } },
      include: { organization: { select: { id: true, name: true, logoUrl: true, primaryVertical: true } } },
    });
    for (const adult of householdAdults) {
      // PTA/PTO is a first-class vertical (PR #40) — included whenever the
      // organization's own primaryVertical is PTA, never a separate Labs
      // enrollment (see docs/pta-access-architecture.md).
      if (adult.organization.primaryVertical !== "PTA") continue;

      rawVerticalByOrgId.set(adult.organizationId, "PTA");
      confirmedPtaOrgIds.add(adult.organizationId);
      const existing = rows.get(adult.organizationId);
      const [firstName, ...lastParts] = adult.name.split(" ");
      if (existing) {
        existing.pta = { householdAdultId: adult.id, householdName: null, isOfficer: existing.pta?.isOfficer ?? false, canCheckIn: existing.pta?.canCheckIn ?? false, canApproveHours: existing.pta?.canApproveHours ?? false };
      } else {
        rows.set(adult.organizationId, {
          organizationId: adult.organizationId,
          organizationName: adult.organization.name,
          organizationLogoUrl: adult.organization.logoUrl,
          memberId: null,
          firstName: firstName ?? adult.name,
          lastName: lastParts.join(" ") || null,
          membershipStatus: null,
          isDelinquent: false,
          pta: { householdAdultId: adult.id, householdName: null, isOfficer: false, canCheckIn: false, canApproveHours: false },
        });
      }
    }

    // ── 3. PTA officers with a relevant permission ──────────────────────
    const staffMemberships = await prisma.organizationMembership.findMany({
      where: { userId, role: { not: "MEMBER" }, status: "active", organization: { status: "active" } },
      include: { organization: { select: { id: true, name: true, logoUrl: true, status: true, primaryVertical: true } } },
    });
    for (const membership of staffMemberships) {
      // PTA/PTO is a first-class vertical (PR #40) — see the household-adult
      // branch above for the same rationale.
      if (membership.organization.primaryVertical !== "PTA") continue;

      const effective = await getEffectivePermissions(membership.organizationId, membership.role as Role);
      const canCheckIn = effective.includes(PERMISSIONS.PTA_VOLUNTEERS_CHECKIN);
      const canApproveHours = effective.includes(PERMISSIONS.PTA_VOLUNTEER_HOURS_APPROVE);
      if (!canCheckIn && !canApproveHours) continue;

      rawVerticalByOrgId.set(membership.organizationId, "PTA");
      confirmedPtaOrgIds.add(membership.organizationId);
      const existing = rows.get(membership.organizationId);
      if (existing) {
        existing.pta = { householdAdultId: existing.pta?.householdAdultId ?? null, householdName: null, isOfficer: true, canCheckIn, canApproveHours };
      } else {
        rows.set(membership.organizationId, {
          organizationId: membership.organizationId,
          organizationName: membership.organization.name,
          organizationLogoUrl: membership.organization.logoUrl,
          memberId: null,
          firstName: null,
          lastName: null,
          membershipStatus: null,
          isDelinquent: false,
          pta: { householdAdultId: null, householdName: null, isOfficer: true, canCheckIn, canApproveHours },
        });
      }
    }

    const data: (OrgRow & { capability: OrgCapability })[] = await Promise.all(
      Array.from(rows.values()).map(async (row) => {
        const vertical = confirmedPtaOrgIds.has(row.organizationId)
          ? "PTA"
          : await resolveEffectiveVertical(row.organizationId, rawVerticalByOrgId.get(row.organizationId) ?? "COMMUNITY");
        return { ...row, capability: buildCapability(vertical, row.pta !== null) };
      })
    );

    return Response.json({ ok: true, data });
  });
}
