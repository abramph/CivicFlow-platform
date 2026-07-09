import { cookies } from "next/headers";
import type { OrgRole } from "@prisma/client";
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
  role: OrgRole;
  /** This user's OrgMember.id in this org, if a constituent record exists (e.g. MEMBER-role users, or staff who are also dues-paying members). */
  memberId: string | null;
  memberStatus: string | null;
}

/**
 * Every organization the user actively belongs to, oldest membership first.
 * Excludes suspended `OrganizationMembership` rows and orgs whose own
 * status isn't "active" — a suspended membership or org behaves exactly
 * like the user isn't a member there at all.
 */
export async function getUserOrgMemberships(userId: string): Promise<OrgMembershipSummary[]> {
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId, status: "active", organization: { status: "active" } },
    orderBy: { joinedAt: "asc" },
    include: { organization: { select: { id: true, name: true, logoUrl: true } } },
  });
  if (memberships.length === 0) return [];

  const members = await prisma.orgMember.findMany({
    where: { userId, organizationId: { in: memberships.map((m) => m.organizationId) } },
    select: { id: true, organizationId: true, membershipStatus: true },
  });
  const memberByOrg = new Map(members.map((m) => [m.organizationId, m]));

  return memberships.map((m) => {
    const member = memberByOrg.get(m.organizationId);
    return {
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      organizationLogoUrl: m.organization.logoUrl,
      role: m.role,
      memberId: member?.id ?? null,
      memberStatus: member?.membershipStatus ?? null,
    };
  });
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
