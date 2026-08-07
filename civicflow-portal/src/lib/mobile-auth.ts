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
import { getEffectivePermissions } from "@/lib/role-permissions";
import type { Permission, Role } from "@/lib/rbac";

/**
 * PTA/PTO is a first-class vertical (PR #40) — mobile access, like web, is
 * gated on Organization.primaryVertical alone, never a separate Labs
 * enrollment (see docs/pta-access-architecture.md).
 */
export async function requirePtaVerticalForMobile(organizationId: string): Promise<void> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { primaryVertical: true, status: true },
  });
  if (!organization || organization.primaryVertical !== "PTA" || organization.status !== "active") {
    throw new MobileForbiddenError("PTA is not available for this organization");
  }
}

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
 * verified — checks the account is eligible for the mobile app at all, then
 * issues a fresh token pair.
 *
 * Eligibility is ANY of three independent identities:
 *  1. A real OrganizationMembership{role: MEMBER} row (the general member case).
 *  2. A PtaHouseholdAdult.userId link in at least one PTA household
 *     (household adults deliberately have no OrganizationMembership at all —
 *     the household's single shared OrgMember is a billing identity, not a
 *     per-adult one; see requireMobilePtaHouseholdAccess()). Without this
 *     branch, no PTA parent could ever obtain a mobile token.
 *  3. A real active non-MEMBER (staff/officer) OrganizationMembership row —
 *     added for the Mobile Admin program. Discovered via a live login
 *     walkthrough (not a mocked test) that an officer with no personal
 *     MEMBER identity of their own — the normal case for an ORG_OWNER/
 *     ORG_ADMIN who isn't also enrolled as a dues-paying member — was
 *     rejected at login before ever reaching GET /api/mobile/organizations'
 *     own (already-correct) staff-membership branch, making the entire
 *     Admin tab permanently unreachable for exactly the people it's for.
 *     This does not itself grant any admin capability — resolveMobileAdminCapabilities()
 *     still independently gates the Labs enrollment and RBAC permission a
 *     staff row must additionally clear before anything admin-shaped becomes
 *     visible; this only lets the account past the login eligibility check.
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
  const [membershipCount, ptaHouseholdAdultCount, staffMembershipCount] = await Promise.all([
    prisma.organizationMembership.count({
      where: { userId: user.id, role: "MEMBER", organization: { status: "active" } },
    }),
    prisma.ptaHouseholdAdult.count({
      where: { userId: user.id, organization: { status: "active" }, household: { status: "ACTIVE" } },
    }),
    prisma.organizationMembership.count({
      where: { userId: user.id, role: { not: "MEMBER" }, status: "active", organization: { status: "active" } },
    }),
  ]);
  if (membershipCount === 0 && ptaHouseholdAdultCount === 0 && staffMembershipCount === 0) {
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
  adult: { id: string; householdId: string; billingMemberId: string | null };
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
 *
 * `billingMemberId` (the household's `orgMemberId`, nullable) is exposed
 * because it is exactly what dues and announcements are actually scoped by
 * server-side — `PtaHousehold.orgMemberId` is the household's one shared
 * billing/communications identity (see `parent-dues.ts` and
 * `communications.ts`'s `resolvePtaTargetMemberIds()`), never a per-adult
 * one. Every caller of this function must re-derive any query from this
 * value, never accept a client-supplied memberId.
 */
export async function requireMobilePtaHouseholdAccess(
  request: Request,
  organizationId: string
): Promise<MobilePtaHouseholdAccess> {
  const session = await requireMobileAuth(request);

  await requirePtaVerticalForMobile(organizationId);

  const adult = await prisma.ptaHouseholdAdult.findFirst({
    where: { organizationId, userId: session.userId },
    include: { household: { select: { id: true, status: true, orgMemberId: true } } },
  });
  if (!adult) throw new MobileForbiddenError("Your account is not linked to a PTA household in this organization");
  if (adult.household.status !== "ACTIVE") throw new MobileForbiddenError("Your household's PTA membership is not currently active");

  return { session, organizationId, adult: { id: adult.id, householdId: adult.household.id, billingMemberId: adult.household.orgMemberId } };
}

export interface MobileOrgAccess {
  session: MobileSession;
  organizationId: string;
  /** Present only if the caller also has a regular per-user OrgMember (unrelated to PTA-household billing identity). */
  memberId: string | null;
}

/**
 * The loosest of the mobile guards — verifies only that the caller has SOME
 * legitimate, currently-active tie to this organization (a regular
 * membership, a PTA household link, or a staff role), without requiring a
 * personal `OrgMember`. For features whose underlying data model is already
 * scoped by `userId` directly rather than by `OrgMember` — messaging
 * (`ConversationParticipant.userId`) is the motivating case — gating behind
 * `requireMobileMembership()`'s `OrgMember` requirement was an unnecessarily
 * strict assumption inherited from the "conventional member" case, not
 * something the underlying query actually needed. Never grants any
 * additional data access by itself — each route still scopes its own
 * queries by `session.userId`/`organizationId` exactly as before.
 */
export async function requireMobileOrgAccess(request: Request, organizationId: string): Promise<MobileOrgAccess> {
  const session = await requireMobileAuth(request);

  const [membership, householdAdult, staffMembership] = await Promise.all([
    prisma.organizationMembership.findFirst({
      where: { userId: session.userId, organizationId, role: "MEMBER", status: "active", organization: { status: "active" } },
    }),
    prisma.ptaHouseholdAdult.findFirst({
      where: { organizationId, userId: session.userId, organization: { status: "active" }, household: { status: "ACTIVE" } },
    }),
    prisma.organizationMembership.findFirst({
      where: { userId: session.userId, organizationId, role: { not: "MEMBER" }, status: "active", organization: { status: "active" } },
    }),
  ]);

  if (!membership && !householdAdult && !staffMembership) {
    throw new MobileForbiddenError("No active access to this organization");
  }

  const member = membership
    ? await prisma.orgMember.findFirst({ where: { userId: session.userId, organizationId }, select: { id: true } })
    : null;

  return { session, organizationId, memberId: member?.id ?? null };
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
 *
 * Vertical-agnostic by design (originally hardcoded to
 * `requirePtaVerticalForMobile()`, generalized for the Mobile Admin
 * program — see docs/mobile-admin-architecture.md): a permission alone
 * already implies its vertical (e.g. `hoa:violations:write` cannot be held
 * on a non-HOA org's effective permission set), so a caller whose feature IS
 * genuinely vertical-locked (like the PTA volunteer routes below) checks
 * that separately and explicitly, rather than this shared guard assuming
 * every caller means PTA.
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

  const effective = await getEffectivePermissions(organizationId, membership.role as Role);
  if (!effective.includes(permission)) {
    throw new MobileForbiddenError(`Permission denied: ${permission}`);
  }

  return { session, organizationId, role: membership.role };
}
