import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { ForbiddenError } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

export interface MemberWebSession {
  userId: string;
  organizationId: string;
  memberId: string;
  organizations: { organizationId: string; organizationName: string }[];
}

/**
 * Resolves the logged-in web visitor as a CivicFlow member (role MEMBER),
 * for the member-facing web fallback pages (/m/*). Returns null if the
 * visitor isn't authenticated or isn't a member — callers should render
 * the "open in app / log in" fallback UI in that case.
 *
 * `requestedOrgId` (from a `?org=` query param) lets a member who belongs to
 * multiple organizations pick one; it's validated against their actual
 * memberships, never trusted blindly.
 */
export async function getMemberWebSession(requestedOrgId?: string): Promise<MemberWebSession | null> {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return null;

  const memberships = await prisma.organizationMembership.findMany({
    where: { userId: session.userId, role: "MEMBER", organization: { status: "active" } },
    orderBy: { joinedAt: "asc" },
    include: { organization: { select: { id: true, name: true } } },
  });
  if (memberships.length === 0) return null;

  const organizationId =
    (requestedOrgId && memberships.some((m) => m.organizationId === requestedOrgId) ? requestedOrgId : null) ??
    memberships[0].organizationId;

  const member = await prisma.orgMember.findFirst({
    where: { userId: session.userId, organizationId },
    select: { id: true },
  });
  if (!member) return null;

  return {
    userId: session.userId,
    organizationId,
    memberId: member.id,
    organizations: memberships.map((m) => ({ organizationId: m.organizationId, organizationName: m.organization.name })),
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
