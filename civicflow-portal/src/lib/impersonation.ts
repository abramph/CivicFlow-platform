import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getPlatformAccessForUser } from "@/lib/platform-access";
import { ACTIVE_ORG_COOKIE } from "@/lib/org-context";

/**
 * Platform Administrator impersonation — lets a SUPER_ADMIN experience the
 * product exactly as a real (or fictional demo) organization member does,
 * for demos, QA, and support.
 *
 * Design: the signed JWT itself is NEVER mutated to represent the target
 * user — `token.userId` always remains the real platform admin's id for the
 * lifetime of the browser session. Impersonation is instead an *overlay*
 * applied inside authOptions.ts's `session()` callback, driven by a small,
 * httpOnly cookie. Every existing authorization guard (requireOrganization,
 * requirePermission, requireSuperAdmin, ...) reads from the session object
 * that callback produces, not from the raw token — so they all automatically
 * see the impersonated identity with zero changes to any of them, and
 * `hasPlatformAccess`/`platformRoles` are recomputed for the TARGET user, so
 * no platform-admin ability leaks into the impersonated view.
 *
 * The critical safety property lives in resolveImpersonationOverlay(): it
 * re-verifies, on EVERY session read (not just at start), that the REAL
 * signed-in identity still holds platform access and that the target still
 * belongs to the pinned organization. Any failure fails closed (returns
 * null, i.e. "not impersonating") — it never fails open. Because the cookie
 * is only ever read (never written) inside the session callback, this is
 * safe to call from a plain Server Component render, where Next.js forbids
 * mutating cookies.
 */

export const IMPERSONATION_COOKIE = "cf_impersonation";
const MAX_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours — a forgotten session self-expires rather than lingering indefinitely.

export interface ImpersonationCookiePayload {
  actorUserId: string;
  /** Carried through so the "ended" audit event can attribute the real admin by email even though, by the time stop() runs, the ambient session resolves to the TARGET's identity, not the admin's. */
  actorEmail: string;
  targetUserId: string;
  organizationId: string;
  /** Random, generated at start — correlates the start/end audit events for this one session. */
  sessionId: string;
  startedAt: string;
  reason: string | null;
  /** The admin's own cf_active_org value at the moment impersonation began, restored on exit. */
  priorActiveOrgId: string | null;
}

export interface ImpersonationOverlay {
  actorUserId: string;
  actorEmail: string;
  actorDisplayName: string | null;
  targetUserId: string;
  targetDisplayName: string | null;
  targetEmail: string;
  organizationId: string;
  organizationName: string;
  sessionId: string;
  startedAt: string;
  reason: string | null;
}

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Only ever called from a Route Handler (start/stop), never from the session callback. */
export async function beginImpersonationCookies(payload: ImpersonationCookiePayload) {
  const store = await cookies();
  store.set(IMPERSONATION_COOKIE, JSON.stringify(payload), cookieOptions(MAX_DURATION_MS / 1000));
  store.set(ACTIVE_ORG_COOKIE, payload.organizationId, cookieOptions(60 * 60 * 24 * 365));
}

/** Only ever called from a Route Handler (stop), never from the session callback. */
export async function endImpersonationCookies(payload: ImpersonationCookiePayload) {
  const store = await cookies();
  store.delete(IMPERSONATION_COOKIE);
  if (payload.priorActiveOrgId) {
    store.set(ACTIVE_ORG_COOKIE, payload.priorActiveOrgId, cookieOptions(60 * 60 * 24 * 365));
  } else {
    store.delete(ACTIVE_ORG_COOKIE);
  }
}

/** Read-only — safe to call from a Route Handler or the session callback. */
export async function readImpersonationCookiePayload(): Promise<ImpersonationCookiePayload | null> {
  const raw = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ImpersonationCookiePayload;
  } catch {
    return null;
  }
}

/**
 * The fail-closed re-validation gate. Called on every session() invocation
 * with the REAL, JWT-signed userId (never the cookie's own claimed actor).
 * Returns null — silently, without attempting to clear the cookie (cookies
 * cannot be mutated from a plain Server Component render) — the moment any
 * check doesn't hold, so a lost platform-access grant, a deactivated target,
 * a suspended organization, or a tampered/expired cookie all fall back to
 * the real, non-impersonated identity rather than ever failing open.
 */
export async function resolveImpersonationOverlay(realUserId: string): Promise<ImpersonationOverlay | null> {
  const payload = await readImpersonationCookiePayload();
  if (!payload) return null;
  if (payload.actorUserId !== realUserId) return null;

  const startedAtMs = Date.parse(payload.startedAt);
  if (!Number.isFinite(startedAtMs) || Date.now() - startedAtMs > MAX_DURATION_MS) return null;

  // Re-checked every time, not just at start — a platform-access revocation
  // mid-session takes effect on the very next request, exactly like the
  // ordinary (non-impersonated) hasPlatformAccess check already does.
  const access = await getPlatformAccessForUser(realUserId);
  if (!access.hasPlatformAccess) return null;

  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: payload.targetUserId, organizationId: payload.organizationId, status: "active" },
    include: { organization: { select: { name: true, status: true } } },
  });
  if (!membership || membership.organization.status !== "active") return null;

  const [actor, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: realUserId }, select: { email: true, displayName: true } }),
    prisma.user.findUnique({ where: { id: payload.targetUserId }, select: { email: true, displayName: true } }),
  ]);
  if (!actor || !target) return null;

  return {
    actorUserId: realUserId,
    actorEmail: actor.email,
    actorDisplayName: actor.displayName,
    targetUserId: payload.targetUserId,
    targetDisplayName: target.displayName,
    targetEmail: target.email,
    organizationId: payload.organizationId,
    organizationName: membership.organization.name,
    sessionId: payload.sessionId,
    startedAt: payload.startedAt,
    reason: payload.reason,
  };
}
