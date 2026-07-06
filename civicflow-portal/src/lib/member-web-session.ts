import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { ForbiddenError } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

export const MEMBER_ORG_COOKIE = "cf_member_org";

export interface MemberWebSession {
  userId: string;
  organizationId: string;
  memberId: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  organizations: { organizationId: string; organizationName: string; organizationLogoUrl: string | null }[];
}

/**
 * Resolves the logged-in web visitor as a CivicFlow member (role MEMBER),
 * for the member-facing web fallback pages (/m/*). Returns null if the
 * visitor isn't authenticated or isn't a member — callers should render
 * the "open in app / log in" fallback UI in that case.
 *
 * `requestedOrgId` (from a `?org=` query param) lets a member who belongs to
 * multiple organizations pick one; it's validated against their actual
 * memberships, never trusted blindly. When omitted, falls back to the
 * member's last-selected org (the `cf_member_org` cookie, set by the
 * select-organization endpoint) so switching orgs sticks across every link,
 * not just ones that happen to carry `?org=`; if that's also unset or stale,
 * falls back to their oldest membership.
 */
export async function getMemberWebSession(requestedOrgId?: string): Promise<MemberWebSession | null> {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return null;

  const memberships = await prisma.organizationMembership.findMany({
    where: { userId: session.userId, role: "MEMBER", organization: { status: "active" } },
    orderBy: { joinedAt: "asc" },
    include: { organization: { select: { id: true, name: true, logoUrl: true } } },
  });
  if (memberships.length === 0) return null;

  const cookieOrgId = (await cookies()).get(MEMBER_ORG_COOKIE)?.value;

  const organizationId =
    (requestedOrgId && memberships.some((m) => m.organizationId === requestedOrgId) ? requestedOrgId : null) ??
    (cookieOrgId && memberships.some((m) => m.organizationId === cookieOrgId) ? cookieOrgId : null) ??
    memberships[0].organizationId;

  const member = await prisma.orgMember.findFirst({
    where: { userId: session.userId, organizationId },
    select: { id: true },
  });
  if (!member) return null;

  const activeMembership = memberships.find((m) => m.organizationId === organizationId)!;

  return {
    userId: session.userId,
    organizationId,
    memberId: member.id,
    organizationName: activeMembership.organization.name,
    organizationLogoUrl: activeMembership.organization.logoUrl,
    organizations: memberships.map((m) => ({
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      organizationLogoUrl: m.organization.logoUrl,
    })),
  };
}

/**
 * API-route variant: requires the caller to actually hold a MEMBER
 * membership in the given organizationId, throwing (not redirecting) on
 * failure. organizationId is re-verified server-side, never trusted from
 * the request body alone.
 */
export async function requireMemberWebSession(organizationId: string): Promise<MemberWebSession> {
  const memberSession = await getMemberWebSession(organizationId);
  if (!memberSession || memberSession.organizationId !== organizationId) {
    throw new ForbiddenError("No active member session for this organization");
  }
  return memberSession;
}
