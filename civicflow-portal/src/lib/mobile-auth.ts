/**
 * Unestra SaaS — Mobile (bearer-token) authentication
 *
 * The portal's staff session is cookie-based NextAuth JWT (see authOptions.ts /
 * auth-guards.ts), which doesn't work for a native mobile client. Mobile members
 * authenticate via a separate bearer-token flow: short-lived access tokens +
 * longer-lived refresh tokens, signed with MOBILE_JWT_SECRET.
 *
 * organizationId is NEVER trusted from client input — requireMobileMembership
 * always re-derives it from the caller's OrganizationMembership row.
 *
 * Revocation: both token types embed the User.mobileTokenVersion they were
 * issued with. Since they're otherwise stateless JWTs (no denylist), this is
 * the only way to kill an outstanding token before its natural expiry —
 * bumping the version (password reset, mobile logout) invalidates every
 * previously-issued access/refresh token for that user at once.
 */
import { SignJWT, jwtVerify } from "jose";
import { getServerEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireOrganizationLabFeature } from "@/lib/labs/access";
import { getEffectivePermissions } from "@/lib/role-permissions";
import type { Permission, Role } from "@/lib/rbac";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function getSecretKey() {
  const secret = getServerEnv().MOBILE_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "MOBILE_JWT_SECRET is not configured — set it in the environment before using mobile auth."
    );
  }
  return new TextEncoder().encode(secret);
}

export class MobileAuthError extends Error {
  readonly status = 401;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "MobileAuthError";
  }
}

export class MobileForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "MobileForbiddenError";
  }
}

async function signToken(userId: string, type: "access" | "refresh", ttlSeconds: number, tokenVersion: number) {
  return new SignJWT({ sub: userId, type, v: tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(getSecretKey());
}

export function signAccessToken(userId: string, tokenVersion: number) {
  return signToken(userId, "access", ACCESS_TOKEN_TTL_SECONDS, tokenVersion);
}

export function signRefreshToken(userId: string, tokenVersion: number) {
  return signToken(userId, "refresh", REFRESH_TOKEN_TTL_SECONDS, tokenVersion);
}

/**
 * @param tokenVersion The user's *current* User.mobileTokenVersion — always
 * pass the value just read from the DB, never a cached/stale one, since this
 * is exactly what a caller uses to prove the pair isn't already revoked.
 */
export async function signMobileTokenPair(userId: string, tokenVersion: number) {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(userId, tokenVersion),
    signRefreshToken(userId, tokenVersion),
  ]);
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

/**
 * Shared final step of mobile login, used both by the direct (no-MFA) path
 * in mobile/auth/login and by mobile/auth/mfa/challenge once a code is
 * verified — checks the account is eligible for the member-facing app at
 * all, then issues a fresh token pair.
 *
 * Eligibility is EITHER of two independent identities, since PTA parents are
 * not "regular" members: a real OrganizationMembership{role: MEMBER} row
 * (the general case), OR a PtaHouseholdAdult.userId link in at least one PTA
 * household (household adults deliberately have no OrganizationMembership at
 * all — the household's single shared OrgMember is a billing identity, not a
 * per-adult one; see requireMobilePtaHouseholdAccess()). Without this second
 * branch, no PTA parent could ever obtain a mobile token — the PTA volunteer
 * app would be permanently unreachable for its actual target audience.
 */
export async function completeMobileLogin(user: {
  id: string;
  email: string;
  displayName: string | null;
  mobileTokenVersion: number;
}): Promise<
  | { ok: true; data: { accessToken: string; refreshToken: string; expiresIn: number; user: { id: string; email: string; displayName: string | null } } }
  | { ok: false; status: number; error: string }
> {
  const [membershipCount, ptaHouseholdAdultCount] = await Promise.all([
    prisma.organizationMembership.count({
      where: { userId: user.id, role: "MEMBER", organization: { status: "active" } },
    }),
    prisma.ptaHouseholdAdult.count({
      where: { userId: user.id, organization: { status: "active" }, household: { status: "ACTIVE" } },
    }),
  ]);
  if (membershipCount === 0 && ptaHouseholdAdultCount === 0) {
    return {
      ok: false,
      status: 403,
      error: "This account is not set up as a Unestra member. Ask your organization for an app invite.",
    };
  }

  const tokens = await signMobileTokenPair(user.id, user.mobileTokenVersion);
  return {
    ok: true,
    data: {
      ...tokens,
      user: { id: user.id, email: user.email, displayName: user.displayName },
    },
  };
}

interface MobileTokenClaims {
  userId: string;
  tokenVersion: number;
}

async function verifyMobileToken(token: string, expectedType: "access" | "refresh"): Promise<MobileTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (payload.type !== expectedType || typeof payload.sub !== "string" || typeof payload.v !== "number") return null;
    return { userId: payload.sub, tokenVersion: payload.v };
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string) {
  return verifyMobileToken(token, "refresh");
}

function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export interface MobileSession {
  userId: string;
  email: string;
}

/**
 * Requires a valid mobile access token. Throws MobileAuthError (401) if missing/invalid.
 */
export async function requireMobileAuth(request: Request): Promise<MobileSession> {
  const token = getBearerToken(request);
  if (!token) throw new MobileAuthError("Missing bearer token");

  const claims = await verifyMobileToken(token, "access");
  if (!claims) throw new MobileAuthError("Invalid or expired access token");

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, email: true, mobileTokenVersion: true },
  });
  if (!user) throw new MobileAuthError("Account no longer exists");
  if (user.mobileTokenVersion !== claims.tokenVersion) {
    throw new MobileAuthError("Invalid or expired access token");
  }

  return { userId: user.id, email: user.email };
}

export interface MobileMembership {
  session: MobileSession;
  organizationId: string;
  memberId: string;
}

/**
 * Requires the caller to hold an active MEMBER-role OrganizationMembership for
 * the given organizationId, with a linked OrgMember record. The organizationId
 * is whatever the client asked for, but access is only granted if a matching
 * membership actually exists — never trusted on the client's say-so alone.
 */
export async function requireMobileMembership(
  request: Request,
  organizationId: string
): Promise<MobileMembership> {
  const session = await requireMobileAuth(request);

  const membership = await prisma.organizationMembership.findFirst({
    where: {
      userId: session.userId,
      organizationId,
      role: "MEMBER",
      organization: { status: "active" },
    },
  });
  if (!membership) throw new MobileForbiddenError("No active membership for this organization");

  const member = await prisma.orgMember.findFirst({
    where: { userId: session.userId, organizationId },
    select: { id: true },
  });
  if (!member) throw new MobileForbiddenError("No linked member record for this organization");

  return { session, organizationId, memberId: member.id };
}

export interface MobilePtaHouseholdAccess {
  session: MobileSession;
  organizationId: string;
  adult: { id: string; householdId: string };
}

/**
 * Mobile equivalent of `requirePtaHouseholdSelfAccess()` (src/lib/labs/pta/guard.ts).
 * A PTA parent is resolved via `PtaHouseholdAdult.userId`, never via
 * `OrganizationMembership`/`OrgMember` — most household adults (everyone
 * except an officer who also happens to be a parent) have no membership row
 * at all, since the household's single shared `OrgMember` is a billing
 * identity, not a per-adult one. This intentionally does NOT reuse
 * `requireMobileMembership()`, which requires exactly the membership row PTA
 * parents don't have.
 */
export async function requireMobilePtaHouseholdAccess(
  request: Request,
  organizationId: string
): Promise<MobilePtaHouseholdAccess> {
  const session = await requireMobileAuth(request);

  await requireOrganizationLabFeature(organizationId, "ptaVertical").catch(() => {
    throw new MobileForbiddenError("PTA is not available for this organization");
  });

  const adult = await prisma.ptaHouseholdAdult.findFirst({
    where: { organizationId, userId: session.userId },
    include: { household: { select: { id: true, status: true } } },
  });
  if (!adult) throw new MobileForbiddenError("Your account is not linked to a PTA household in this organization");
  if (adult.household.status !== "ACTIVE") throw new MobileForbiddenError("Your household's PTA membership is not currently active");

  return { session, organizationId, adult: { id: adult.id, householdId: adult.household.id } };
}

export interface MobileStaffAccess {
  session: MobileSession;
  organizationId: string;
  role: string;
}

/**
 * Mobile equivalent of `requirePtaAccess(permission)` (officer-side). Unlike
 * the parent guard above, this resolves via a real `OrganizationMembership`
 * — officers (President, Volunteer Coordinator, etc.) always have one,
 * regardless of whether they're also a household adult. `MEMBER`-role
 * accounts are excluded up front since `getEffectivePermissions()` already
 * hard-codes zero permissions for that role (see role-permissions.ts) — this
 * is just a clearer 403 than letting every subsequent permission check fail.
 */
export async function requireMobileStaffPermission(
  request: Request,
  organizationId: string,
  permission: Permission
): Promise<MobileStaffAccess> {
  const session = await requireMobileAuth(request);

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: session.userId, organizationId, status: "active", organization: { status: "active" }, role: { not: "MEMBER" } },
  });
  if (!membership) throw new MobileForbiddenError("No active staff membership for this organization");

  await requireOrganizationLabFeature(organizationId, "ptaVertical").catch(() => {
    throw new MobileForbiddenError("PTA is not available for this organization");
  });

  const effective = await getEffectivePermissions(organizationId, membership.role as Role);
  if (!effective.includes(permission)) {
    throw new MobileForbiddenError(`Permission denied: ${permission}`);
  }

  return { session, organizationId, role: membership.role };
}
