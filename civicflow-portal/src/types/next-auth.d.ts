import "next-auth";
import "next-auth/jwt";
import type { OrgRole, OrganizationVertical, PlatformRole } from "@prisma/client";

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
    // The active organization's authoritative product-experience
    // classification (see Organization.primaryVertical) — resolved fresh
    // from the database on every session read, same as role/permissions.
    // Drives client-side navigation/terminology; never itself a source of
    // server-side authorization.
    primaryVertical?: OrganizationVertical | null;
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
      primaryVertical: OrganizationVertical;
      role: OrgRole;
      memberId: string | null;
      memberStatus: string | null;
      isPtaHouseholdOnly: boolean;
    }[];
    // Effective (org-customized) permission set for the current role
    permissions?: string[];
    // ENABLED Unestra Labs feature keys for the active organization (e.g.
    // "memberIntake") — resolved fresh on every session read, same
    // discipline as permissions/primaryVertical. Drives which Labs-gated
    // nav items appear (see vertical-navigation.ts's getNavigationProfile)
    // so an org without a feature enrolled never sees a dead-end link to
    // it; never itself a source of server-side authorization (routes/pages
    // still call requireOrganizationLabFeature independently).
    enabledLabFeatures?: string[];
    // Global platform-operator access — independent of active organization
    // (see PlatformAccess in schema.prisma). Resolved fresh from the
    // database on every session read, never cached in the signed JWT, so a
    // revocation takes effect on the next request rather than lingering
    // until the token itself expires or rotates. Only the minimum derived
    // fields are exposed here; the raw PlatformAccess row never reaches
    // the client.
    hasPlatformAccess?: boolean;
    platformRoles?: PlatformRole[];
    // Set only while a SUPER_ADMIN is actively impersonating another user
    // (see src/lib/impersonation.ts). Re-validated fresh on every session
    // read — never trust this as a standing grant. actorUserId/actorEmail
    // identify the REAL platform admin driving the session; every other
    // top-level session field (userId, role, permissions, ...) reflects the
    // TARGET user, exactly as if they had signed in themselves.
    impersonation?: {
      active: true;
      actorUserId: string;
      actorEmail: string;
      actorDisplayName: string | null;
      targetUserId: string;
      targetDisplayName: string | null;
      targetEmail: string;
      organizationId: string;
      organizationName: string;
      startedAt: string;
      reason: string | null;
    };
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
