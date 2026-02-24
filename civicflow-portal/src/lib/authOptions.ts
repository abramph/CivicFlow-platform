import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const defaultApiBase = process.env.NEXT_PUBLIC_API_BASE || "https://api.civicflowapp.com/api";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Organization API Key",
      credentials: {
        org_id: { label: "Organization ID", type: "text" },
        api_key: { label: "API Key", type: "password" },
        api_base: { label: "API Base", type: "text" },
      },
      async authorize(credentials) {
        const orgId = String(credentials?.org_id || "").trim();
        const apiKey = String(credentials?.api_key || "").trim();
        const apiBase = String(credentials?.api_base || defaultApiBase).replace(/\/+$/, "");
        if (!orgId || !apiKey) return null;

        return {
          id: orgId,
          name: orgId,
          org_id: orgId,
          api_key: apiKey,
          api_base: apiBase,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.org_id = String((user as { org_id?: string }).org_id || "");
        token.api_key = String((user as { api_key?: string }).api_key || "");
        token.api_base = String((user as { api_base?: string }).api_base || defaultApiBase);
      }
      return token;
    },
    async session({ session, token }) {
      session.org_id = String(token.org_id || "");
      session.api_key = String(token.api_key || "");
      session.api_base = String(token.api_base || defaultApiBase);
      return session;
    },
  },
};
