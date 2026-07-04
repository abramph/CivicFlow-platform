/**
 * CivicFlow SaaS — Mobile (bearer-token) authentication
 *
 * The portal's staff session is cookie-based NextAuth JWT (see authOptions.ts /
 * auth-guards.ts), which doesn't work for a native mobile client. Mobile members
 * authenticate via a separate bearer-token flow: short-lived access tokens +
 * longer-lived refresh tokens, signed with MOBILE_JWT_SECRET.
 *
 * organizationId is NEVER trusted from client input — requireMobileMembership
 * always re-derives it from the caller's OrganizationMembership row.
 */
import { SignJWT, jwtVerify } from "jose";
import { getServerEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

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

async function signToken(userId: string, type: "access" | "refresh", ttlSeconds: number) {
  return new SignJWT({ sub: userId, type })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(getSecretKey());
}

export function signAccessToken(userId: string) {
  return signToken(userId, "access", ACCESS_TOKEN_TTL_SECONDS);
}

export function signRefreshToken(userId: string) {
  return signToken(userId, "refresh", REFRESH_TOKEN_TTL_SECONDS);
}

export async function signMobileTokenPair(userId: string) {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(userId),
    signRefreshToken(userId),
  ]);
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

async function verifyMobileToken(token: string, expectedType: "access" | "refresh") {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (payload.type !== expectedType || typeof payload.sub !== "string") return null;
    return payload.sub;
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

  const userId = await verifyMobileToken(token, "access");
  if (!userId) throw new MobileAuthError("Invalid or expired access token");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) throw new MobileAuthError("Account no longer exists");

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
