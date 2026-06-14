import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const defaultApiBase = process.env.NEXT_PUBLIC_API_BASE || "https://api.civicflowapp.com/api";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    // ── SaaS: email + password, verified against the PostgreSQL database ──
    CredentialsProvider({
      id: "saas-credentials",
      name: "CivicFlow",
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

        // In production, block unverified accounts. In dev, allow them through.
        if (!user.emailVerified && process.env.NODE_ENV === "production") return null;

        // organizationId is always derived server-side — never from the client.
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

    // ── Legacy: Organization API Key (preserved for existing portal usage) ──
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
        // SaaS fields
        if ((user as { organizationId?: unknown }).organizationId !== undefined) {
          token.userId         = user.id;
          token.userEmail      = user.email ?? "";
          token.organizationId = (user as { organizationId?: string | null }).organizationId ?? null;
          token.role           = (user as { role?: string | null }).role as typeof token.role ?? null;
        }
        // Legacy fields
        if ((user as { org_id?: string }).org_id) {
          token.org_id   = String((user as { org_id?: string }).org_id   || "");
          token.api_key  = String((user as { api_key?: string }).api_key  || "");
          token.api_base = String((user as { api_base?: string }).api_base || defaultApiBase);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId) {
        const [membership, user] = await Promise.all([
          prisma.organizationMembership.findFirst({
            where: {
              userId: String(token.userId),
              organization: { status: "active" },
            },
            orderBy: { joinedAt: "asc" },
            include: { organization: { select: { name: true } } },
          }),
          prisma.user.findUnique({
            where: { id: String(token.userId) },
            select: { email: true },
          }),
        ]);

        session.userId = String(token.userId);
        session.userEmail = user?.email ?? String(token.userEmail || "");
        session.organizationId = membership?.organizationId ?? null;
        session.orgName = membership?.organization?.name ?? null;
        session.role = membership?.role ?? null;
      } else {
      // SaaS
        session.userId = token.userId;
        session.userEmail = token.userEmail;
        session.organizationId = token.organizationId ?? null;
        session.role = token.role ?? null;
      }
      // Legacy (preserved)
      session.org_id   = String(token.org_id  || "");
      session.api_key  = String(token.api_key || "");
      session.api_base = String(token.api_base || defaultApiBase);
      return session;
    },
  },
};
