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
    // MFA pending state
    mfaPending?: boolean;
    mfaUserId?: string;
    mfaTokenId?: string;
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
    // The active org's OrgMember.id for this user, if a constituent record
    // exists there — lets /m/* pages skip their own separate lookup.
    memberId?: string | null;
    // Every org this user actively belongs to (for org switchers) — see
    // OrgMembershipSummary in src/lib/org-context.ts.
    organizations?: {
      organizationId: string;
      organizationName: string;
      organizationLogoUrl: string | null;
      role: OrgRole;
      memberId: string | null;
      memberStatus: string | null;
    }[];
    // Effective (org-customized) permission set for the current role
    permissions?: string[];
    // MFA pending state
    mfaPending?: boolean;
    mfaUserId?: string;
    mfaTokenId?: string;
    // ISO timestamp the pending challenge token expires at (10-minute TTL,
    // see authOptions.ts) — lets the client show a countdown and detect
    // expiry proactively instead of only after a failed submit.
    mfaChallengeExpiresAt?: string | null;
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
    // MFA pending state
    mfaPending?: boolean;
    mfaUserId?: string;
    mfaTokenId?: string;
  }
}
