import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { ForbiddenError } from "@/lib/auth-guards";
import { ACTIVE_ORG_COOKIE, getUserOrgMemberships } from "@/lib/org-context";

/**
 * @deprecated Superseded by ACTIVE_ORG_COOKIE (src/lib/org-context.ts), which
 * now covers both staff and member surfaces. Still read here as a fallback
 * so cookies set before the two mechanisms were unified keep working.
 */
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
 * Resolves the logged-in web visitor as a Unestra member (role MEMBER),
 * for the member-facing web fallback pages (/m/*). Returns null if the
 * visitor isn't authenticated or isn't a member — callers should render
 * the "open in app / log in" fallback UI in that case.
 *
 * Sources its membership list from the same `getUserOrgMemberships` used by
 * the staff org switcher, so a suspended membership or inactive org is
 * excluded identically on both surfaces.
 *
 * `requestedOrgId` (from a `?org=` query param) lets a member who belongs to
 * multiple organizations pick one; it's validated against their actual
 * memberships, never trusted blindly. When omitted, falls back to the
 * member's last-selected org (the unified `cf_active_org` cookie, or the
 * legacy `cf_member_org` cookie for links/cookies set before unification)
 * so switching orgs sticks across every link, not just ones that happen to
 * carry `?org=`; if that's also unset or stale, falls back to their oldest
 * membership.
 */
export async function getMemberWebSession(requestedOrgId?: string): Promise<MemberWebSession | null> {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return null;

  const memberships = (await getUserOrgMemberships(session.userId)).filter((m) => m.role === "MEMBER");
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const cookieOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? cookieStore.get(MEMBER_ORG_COOKIE)?.value;

  const organizationId =
    (requestedOrgId && memberships.some((m) => m.organizationId === requestedOrgId) ? requestedOrgId : null) ??
    (cookieOrgId && memberships.some((m) => m.organizationId === cookieOrgId) ? cookieOrgId : null) ??
    memberships[0].organizationId;

  const active = memberships.find((m) => m.organizationId === organizationId)!;
  if (!active.memberId) return null;

  return {
    userId: session.userId,
    organizationId,
    memberId: active.memberId,
    organizationName: active.organizationName,
    organizationLogoUrl: active.organizationLogoUrl,
    organizations: memberships.map((m) => ({
      organizationId: m.organizationId,
      organizationName: m.organizationName,
      organizationLogoUrl: m.organizationLogoUrl,
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
