/**
 * CivicFlow SaaS — Server-side auth guard utilities
 *
 * All guards must be called from Server Components or Route Handlers only.
 * They derive organizationId from the session — never from client input.
 *
 * Usage examples:
 *
 *   // Require any authenticated user
 *   const session = await requireAuth();
 *
 *   // Require a user who belongs to an active organization
 *   const { session, organizationId } = await requireOrganization();
 *
 *   // Require a specific permission
 *   const { session, organizationId } = await requirePermission("members:write");
 *
 *   // Require a minimum role
 *   const { session, organizationId } = await requireRole("ORG_ADMIN");
 */

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import type { Permission, Role } from "@/lib/rbac";
import { getEffectivePermissions } from "@/lib/role-permissions";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthedSession extends Session {
  userId: string;
  userEmail: string;
}

export interface OrgSession extends AuthedSession {
  organizationId: string;
  role: Role;
}

/** Synchronous check against the effective (possibly org-customized) permission set already fetched for this request. */
export type PermissionChecker = (permission: Permission) => boolean;

// ─── Role hierarchy ───────────────────────────────────────────────────────────

const ROLE_RANK: Record<Role, number> = {
  MEMBER:      -1,
  READ_ONLY:   0,
  STAFF:       1,
  FINANCE:     2,
  ORG_ADMIN:   3,
  ORG_OWNER:   4,
  SUPER_ADMIN: 5,
};

function roleAtLeast(actual: Role, minimum: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[minimum];
}

/** Numeric rank for a role — higher outranks lower. Exposed so callers can prevent one role from granting/editing a role above its own rank (e.g. an ORG_ADMIN assigning ORG_OWNER). */
export function roleRank(role: Role): number {
  return ROLE_RANK[role];
}

// ─── Guards ───────────────────────────────────────────────────────────────────

/**
 * Requires an authenticated session.
 * Redirects to /login if not authenticated.
 */
export async function requireAuth(): Promise<AuthedSession> {
  const session = await getServerSession(authOptions);

  if (!session?.userId) {
    redirect("/login");
  }

  return session as AuthedSession;
}

/**
 * Requires an authenticated session AND an active organization membership.
 * organizationId and role are always taken from the server session.
 * Redirects to /login if not authenticated, /onboarding/organization if no org.
 */
export async function requireOrganization(): Promise<{
  session: OrgSession;
  organizationId: string;
  role: Role;
  can: PermissionChecker;
}> {
  const session = await getServerSession(authOptions);

  if (!session?.userId) {
    redirect("/login");
  }

  if (!session.organizationId || !session.role) {
    redirect("/onboarding/organization");
  }

  const orgSession = session as OrgSession;
  const effectivePermissions = await getEffectivePermissions(orgSession.organizationId, orgSession.role);
  const can: PermissionChecker = (permission) =>
    orgSession.role === "SUPER_ADMIN" || effectivePermissions.includes(permission);

  return {
    session:        orgSession,
    organizationId: orgSession.organizationId,
    role:           orgSession.role,
    can,
  };
}

/**
 * Requires an authenticated org session with the given permission.
 * Returns 403 JSON response from API routes or redirects from pages.
 *
 * @param permission  A permission string, e.g. "members:write"
 * @param onForbidden Optional override: "redirect" (default for pages) |
 *                    "throw" (use in Route Handlers to return 403 JSON)
 */
export async function requirePermission(
  permission: Permission,
  onForbidden: "redirect" | "throw" = "redirect"
): Promise<{ session: OrgSession; organizationId: string; role: Role; can: PermissionChecker }> {
  const { session, organizationId, role, can } = await requireOrganization();

  if (!can(permission)) {
    if (onForbidden === "throw") {
      throw new ForbiddenError(
        `Permission denied: ${permission} (role: ${role})`
      );
    }
    redirect("/dashboard?error=forbidden");
  }

  return { session, organizationId, role, can };
}

/**
 * Requires an authenticated org session with AT LEAST the given role level.
 * Role hierarchy (ascending): READ_ONLY < STAFF < FINANCE < ORG_ADMIN < ORG_OWNER < SUPER_ADMIN
 */
export async function requireRole(
  minimumRole: Role,
  onForbidden: "redirect" | "throw" = "redirect"
): Promise<{ session: OrgSession; organizationId: string; role: Role; can: PermissionChecker }> {
  const { session, organizationId, role, can } = await requireOrganization();

  if (!roleAtLeast(role, minimumRole)) {
    if (onForbidden === "throw") {
      throw new ForbiddenError(
        `Role ${role} does not meet minimum ${minimumRole}`
      );
    }
    redirect("/dashboard?error=forbidden");
  }

  return { session, organizationId, role, can };
}

/**
 * SUPER_ADMIN-only guard.
 * Use for /admin/platform routes.
 */
export async function requireSuperAdmin(
  onForbidden: "redirect" | "throw" = "redirect"
): Promise<{ session: OrgSession; organizationId: string; role: Role; can: PermissionChecker }> {
  return requireRole("SUPER_ADMIN", onForbidden);
}

// ─── Error class for Route Handler usage ─────────────────────────────────────

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Wrap Route Handler logic to catch ForbiddenError and return proper JSON.
 *
 * @example
 *   export async function POST(req: Request) {
 *     return withForbiddenHandler(async () => {
 *       const { organizationId } = await requirePermission("members:write", "throw");
 *       // ... handler logic
 *     });
 *   }
 */
export async function withForbiddenHandler(
  fn: () => Promise<Response>
): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
