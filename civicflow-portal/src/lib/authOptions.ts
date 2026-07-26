import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getEffectivePermissions } from "@/lib/role-permissions";
import { resolveActiveOrganization, getUserOrgMemberships } from "@/lib/org-context";
import { getPlatformAccessForUser } from "@/lib/platform-access";
import { resolveImpersonationOverlay } from "@/lib/impersonation";

const defaultApiBase = process.env.NEXT_PUBLIC_API_BASE || "https://api.civicflowapp.com/api";

/**
 * Resolves every identity-dependent session field for a given userId.
 * Extracted so the session() callback can call it once for the real user
 * and, when a valid impersonation overlay is active, a second time for the
 * target user instead — the exact same derivation either way, so an
 * impersonated session is indistinguishable from that user's own real
 * session to every downstream permission check.
 */
async function resolveSessionIdentity(userId: string) {
  const [active, organizations, user, platformAccess] = await Promise.all([
    resolveActiveOrganization(userId),
    getUserOrgMemberships(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    getPlatformAccessForUser(userId),
  ]);
  const permissions = active?.organizationId && active?.role ? await getEffectivePermissions(active.organizationId, active.role) : [];
  return { active, organizations, user, platformAccess, permissions };
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    // ── SaaS: email + password ──
    CredentialsProvider({
      id: "saas-credentials",
      name: "Unestra",
      credentials: {
        email:    { label: "Email",    type: "email"    },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email    = String(credentials?.email    ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        if (!user.emailVerified && process.env.NODE_ENV === "production") return null;

        // If MFA is enabled, return a pending state instead of a full session.
        if (user.mfaEnabled) {
          await prisma.mfaChallengeToken.deleteMany({
            where: { userId: user.id, expiresAt: { lt: new Date() } },
          });
          const pendingToken = await prisma.mfaChallengeToken.create({
            data: {
              userId: user.id,
              type: "pending",
              expiresAt: new Date(Date.now() + 10 * 60 * 1000),
            },
          });
          return {
            id: "mfa-pending",
            mfaPending: true,
            mfaUserId: user.id,
            mfaTokenId: pendingToken.id,
          } as never;
        }

        const membership = await prisma.organizationMembership.findFirst({
          where:   { userId: user.id },
          orderBy: { joinedAt: "asc" },
          include: { organization: { select: { status: true } } },
        });

        const activeOrg =
          membership?.organization?.status === "active" ? membership : null;

        return {
          id:             user.id,
          email:          user.email,
          displayName:    user.displayName,
          organizationId: activeOrg?.organizationId ?? null,
          role:           activeOrg?.role           ?? null,
        };
      },
    }),

    // ── MFA completion: exchange a short-lived completion token for a full session ──
    CredentialsProvider({
      id: "mfa-complete",
      name: "MFA Complete",
      credentials: {
        completionToken: { label: "Completion Token", type: "text" },
      },
      async authorize(credentials) {
        const tokenValue = String(credentials?.completionToken ?? "").trim();
        if (!tokenValue) return null;

        const record = await prisma.mfaChallengeToken.findUnique({
          where: { token: tokenValue },
        });

        if (!record || record.type !== "completion" || record.expiresAt < new Date()) {
          if (record) await prisma.mfaChallengeToken.delete({ where: { id: record.id } }).catch(() => {});
          return null;
        }

        await prisma.mfaChallengeToken.delete({ where: { id: record.id } });

        const user = await prisma.user.findUnique({ where: { id: record.userId } });
        if (!user) return null;

        const membership = await prisma.organizationMembership.findFirst({
          where:   { userId: user.id },
          orderBy: { joinedAt: "asc" },
          include: { organization: { select: { status: true } } },
        });

        const activeOrg = membership?.organization?.status === "active" ? membership : null;

        return {
          id:             user.id,
          email:          user.email,
          displayName:    user.displayName,
          organizationId: activeOrg?.organizationId ?? null,
          role:           activeOrg?.role           ?? null,
        };
      },
    }),

    // ── Legacy: Organization API Key ──
    CredentialsProvider({
      id: "org-api-key",
      name: "Organization API Key",
      credentials: {
        org_id:   { label: "Organization ID", type: "text"     },
        api_key:  { label: "API Key",         type: "password" },
        api_base: { label: "API Base",        type: "text"     },
      },
      async authorize(credentials) {
        const orgId   = String(credentials?.org_id   || "").trim();
        const apiKey  = String(credentials?.api_key  || "").trim();
        const apiBase = String(credentials?.api_base || defaultApiBase).replace(/\/+$/, "");
        if (!orgId || !apiKey) return null;
        return { id: orgId, name: orgId, org_id: orgId, api_key: apiKey, api_base: apiBase };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as {
          mfaPending?: boolean;
          mfaUserId?: string;
          mfaTokenId?: string;
          organizationId?: string | null;
          role?: string | null;
          org_id?: string;
          api_key?: string;
          api_base?: string;
        };

        if (u.mfaPending) {
          return {
            ...token,
            mfaPending: true,
            mfaUserId: u.mfaUserId,
            mfaTokenId: u.mfaTokenId,
            // Clear any previous full-session data
            userId: undefined,
            userEmail: undefined,
            organizationId: undefined,
            role: undefined,
          };
        }

        // Clear MFA pending state on successful full login
        token.mfaPending = false;
        token.mfaUserId = undefined;
        token.mfaTokenId = undefined;

        if (u.organizationId !== undefined) {
          token.userId         = user.id;
          token.userEmail      = user.email ?? "";
          token.organizationId = u.organizationId ?? null;
          token.role           = u.role as typeof token.role ?? null;
        }
        if (u.org_id) {
          token.org_id   = String(u.org_id   || "");
          token.api_key  = String(u.api_key  || "");
          token.api_base = String(u.api_base || defaultApiBase);
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token.mfaPending) {
        session.mfaPending = true;
        session.mfaUserId  = token.mfaUserId;
        session.mfaTokenId = token.mfaTokenId;
        session.org_id  = "";
        session.api_key = "";
        session.api_base = defaultApiBase;

        // Lets the MFA page show a countdown and proactively detect expiry,
        // instead of the user only finding out via a failed Verify/Text-me
        // submission (which is how this was silently confusing before).
        if (token.mfaTokenId) {
          const challenge = await prisma.mfaChallengeToken.findUnique({
            where: { id: String(token.mfaTokenId) },
            select: { expiresAt: true },
          });
          session.mfaChallengeExpiresAt = challenge?.expiresAt?.toISOString() ?? null;
        }

        return session;
      }

      if (token.userId) {
        const realUserId = String(token.userId);
        // Real, JWT-signed identity — token.userId is NEVER overwritten by
        // impersonation, only this derived session view is. See
        // src/lib/impersonation.ts's module doc comment for why that's the
        // property that keeps this safe.
        const overlay = await resolveImpersonationOverlay(realUserId);
        const effectiveUserId = overlay?.targetUserId ?? realUserId;
        const identity = await resolveSessionIdentity(effectiveUserId);

        session.userId = effectiveUserId;
        session.userEmail = identity.user?.email ?? (overlay ? overlay.targetEmail : String(token.userEmail || ""));
        session.organizationId = identity.active?.organizationId ?? null;
        session.orgName = identity.active?.organizationName ?? null;
        session.role = identity.active?.role ?? null;
        session.memberId = identity.active?.memberId ?? null;
        session.organizations = identity.organizations;
        // Global, active-organization-independent — resolved fresh here on
        // every session read (never persisted in the JWT) so a revocation
        // takes effect on the next request instead of lingering. Resolved
        // for effectiveUserId, so an impersonated session never inherits
        // the real admin's platform access.
        session.hasPlatformAccess = identity.platformAccess.hasPlatformAccess;
        session.platformRoles = identity.platformAccess.platformRoles;
        session.permissions = identity.permissions;
        session.impersonation = overlay
          ? {
              active: true,
              actorUserId: overlay.actorUserId,
              actorEmail: overlay.actorEmail,
              actorDisplayName: overlay.actorDisplayName,
              targetUserId: overlay.targetUserId,
              targetDisplayName: overlay.targetDisplayName,
              targetEmail: overlay.targetEmail,
              organizationId: overlay.organizationId,
              organizationName: overlay.organizationName,
              startedAt: overlay.startedAt,
              reason: overlay.reason,
            }
          : undefined;
      } else {
        session.userId = token.userId;
        session.userEmail = token.userEmail;
        session.organizationId = token.organizationId ?? null;
        session.role = token.role ?? null;
        session.hasPlatformAccess = false;
        session.platformRoles = [];
        session.permissions = [];
        session.impersonation = undefined;
      }

      session.org_id   = String(token.org_id  || "");
      session.api_key  = String(token.api_key || "");
      session.api_base = String(token.api_base || defaultApiBase);
      return session;
    },
  },
};
