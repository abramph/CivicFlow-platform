import "next-auth";
import "next-auth/jwt";
import type { OrgRole } from "@prisma/client";

declare module "next-auth" {
  interface User {
    id: string;
    // Legacy portal API-key auth (preserved)
    org_id?: string;
    api_key?: string;
    api_base?: string;
    // SaaS auth
    email?: string;
    displayName?: string | null;
    organizationId?: string | null;
    role?: OrgRole | null;
  }

  interface Session {
    // Legacy portal API-key auth (preserved)
    org_id: string;
    api_key: string;
    api_base: string;
    // SaaS auth
    userId?: string;
    organizationId?: string | null;
    orgName?: string | null;
    role?: OrgRole | null;
    userEmail?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    // Legacy
    org_id?: string;
    api_key?: string;
    api_base?: string;
    // SaaS
    userId?: string;
    organizationId?: string | null;
    orgName?: string | null;
    role?: OrgRole | null;
    userEmail?: string;
  }
}
