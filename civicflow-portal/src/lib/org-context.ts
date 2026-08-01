import { cookies } from "next/headers";
import type { OrganizationVertical, OrgRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Single cookie used to remember the active organization for BOTH staff
 * (`/dashboard`, `/admin/*`, ...) and member (`/m/*`) surfaces. Replaces the
 * older member-only `cf_member_org` cookie, which `member-web-session.ts`
 * still reads as a fallback so links/bookmarks made before this change keep
 * working.
 */
export const ACTIVE_ORG_COOKIE = "cf_active_org";

export interface OrgMembershipSummary {
  organizationId: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  /** So the org switcher can route to the right landing page (and the client
   * can regenerate nav/terminology) the instant a switch is selected, without
   * waiting on a second round-trip. */
  primaryVertical: OrganizationVertical;
  role: OrgRole;
  /** This user's OrgMember.id in this org, if a constituent record exists (e.g. MEMBER-role users, or staff who are also dues-paying members). */
  memberId: string | null;
  memberStatus: string | null;
  /**
   * True when this entry exists only because the user is a PTA household
   * adult (PtaHouseholdAdult.userId) with no OrganizationMembership row at
   * all in this org — the household's one shared OrgMember is a billing
   * identity, not a per-adult one (see mobile-auth.ts), so a pure parent
   * has no conventional membership to derive a session from. Without this
   * synthetic entry, such a user has zero entries here, resolveActiveOrganization
   * returns null, and the web portal shows "you don't belong to any
   * organization" — a real dead end found via live testing, not a hypothetical.
   */
  isPtaHouseholdOnly: boolean;
}

/**
 * Every organization the user actively belongs to, oldest membership first.
 * Excludes suspended `OrganizationMembership` rows and orgs whose own
 * status isn't "active" — a suspended membership or org behaves exactly
 * like the user isn't a member there at all.
 *
 * Also includes a synthetic entry (role "MEMBER", no memberId) for any org
 * where the user is a PTA household adult but holds no OrganizationMembership
 * there — mirrors the equivalent branch in
 * src/app/api/mobile/organizations/route.ts, which the mobile app already
 * relies on for this exact identity; the web side never had it.
 */
export async function getUserOrgMemberships(userId: string): Promise<OrgMembershipSummary[]> {
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId, status: "active", organization: { status: "active" } },
    orderBy: { joinedAt: "asc" },
    include: { organization: { select: { id: true, name: true, logoUrl: true, primaryVertical: true } } },
  });

  const members = memberships.length
    ? await prisma.orgMember.findMany({
        where: { userId, organizationId: { in: memberships.map((m) => m.organizationId) } },
        select: { id: true, organizationId: true, membershipStatus: true },
      })
    : [];
  const memberByOrg = new Map(members.map((m) => [m.organizationId, m]));
  const coveredOrgIds = new Set(memberships.map((m) => m.organizationId));

  // Deliberately the RAW stored vertical here, not the effective one — this
  // list is read on every session hydration for every org the user belongs
  // to, and reconciling each entry against live PTA Labs enrollment (an
  // extra query per org, per session read) is real, avoidable database load
  // for a list that's mostly just used to render switcher labels. The one
  // place effective-vs-raw actually matters — deciding whether the ACTIVE
  // org's UI/dashboard should show PTA or fall back to COMMUNITY — is
  // reconciled exactly once, for the active org only, in
  // resolveSessionIdentity (authOptions.ts). The switcher's post-switch
  // redirect (PortalShell.switchOrganization) waits for the refreshed
  // session rather than trusting this raw value for that decision.
  const results: (OrgMembershipSummary & { sortKey: Date })[] = memberships.map((m) => {
    const member = memberByOrg.get(m.organizationId);
    return {
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      organizationLogoUrl: m.organization.logoUrl,
      primaryVertical: m.organization.primaryVertical,
      role: m.role,
      memberId: member?.id ?? null,
      memberStatus: member?.membershipStatus ?? null,
      isPtaHouseholdOnly: false,
      sortKey: m.joinedAt,
    };
  });

  const householdAdults = await prisma.ptaHouseholdAdult.findMany({
    where: { userId, organization: { status: "active" }, household: { status: "ACTIVE" } },
    include: { organization: { select: { id: true, name: true, logoUrl: true, primaryVertical: true } } },
  });
  for (const adult of householdAdults) {
    if (coveredOrgIds.has(adult.organizationId)) continue;
    // PTA/PTO is a first-class vertical (PR #40) — a household adult's org
    // is included whenever the organization's own primaryVertical is PTA,
    // never gated behind a separate Labs enrollment (which previously could
    // silently strand a real PTA parent with zero organizations in their
    // switcher — see docs/pta-access-architecture.md).
    if (adult.organization.primaryVertical !== "PTA") continue;
    coveredOrgIds.add(adult.organizationId);
    results.push({
      organizationId: adult.organizationId,
      organizationName: adult.organization.name,
      organizationLogoUrl: adult.organization.logoUrl,
      primaryVertical: adult.organization.primaryVertical,
      role: "MEMBER",
      memberId: null,
      memberStatus: null,
      isPtaHouseholdOnly: true,
      sortKey: adult.createdAt,
    });
  }

  return results
    .sort((a, b) => a.sortKey.getTime() - b.sortKey.getTime())
    .map(({ sortKey: _sortKey, ...rest }) => rest);
}

/**
 * Picks which of the user's organizations is "active" for this request.
 * Order of precedence: an explicitly requested org id (e.g. from a `?org=`
 * param or a select-organization POST body) → the `cf_active_org` cookie →
 * the oldest membership (today's exact default — zero behavior change for
 * single-org users). Never trusts `requestedOrgId` or the cookie value
 * blindly; both are checked against the user's real memberships first.
 * Returns null only when the user has zero active memberships.
 */
export async function resolveActiveOrganization(
  userId: string,
  requestedOrgId?: string | null
): Promise<OrgMembershipSummary | null> {
  const memberships = await getUserOrgMemberships(userId);
  if (memberships.length === 0) return null;

  if (requestedOrgId) {
    const requested = memberships.find((m) => m.organizationId === requestedOrgId);
    if (requested) return requested;
  }

  const cookieOrgId = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  if (cookieOrgId) {
    const remembered = memberships.find((m) => m.organizationId === cookieOrgId);
    if (remembered) return remembered;
  }

  return memberships[0];
}
