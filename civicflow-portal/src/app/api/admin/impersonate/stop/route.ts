import { withApiErrorHandling } from "@/lib/api-route";
import { requireAuth } from "@/lib/auth-guards";
import { createAuditEvent } from "@/lib/audit";
import { endImpersonationCookies, readImpersonationCookiePayload } from "@/lib/impersonation";
import { getClientIp } from "@/lib/rate-limit";

/**
 * Ends the current impersonation session, if any. Deliberately does not
 * re-check requireSuperAdmin() here — while impersonating, getServerSession()
 * resolves the TARGET user's identity (that's the whole point), so a
 * platform-admin-only guard would reject the very admin it's meant to let
 * out. The real admin's identity for the audit trail comes from the cookie
 * payload itself (captured at start, never the ambient session), not from
 * whoever requireAuth() resolves to here. Stopping only ever narrows scope
 * back to the caller's own real session, so it's safe to allow from an
 * impersonated context — the actual authorization boundary is start(),
 * not stop().
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    await requireAuth();

    const payload = await readImpersonationCookiePayload();
    if (!payload) {
      return Response.json({ ok: true, wasImpersonating: false });
    }

    await endImpersonationCookies(payload);

    const durationMs = Date.now() - Date.parse(payload.startedAt);
    await createAuditEvent({
      organizationId: payload.organizationId,
      actorUserId: payload.actorUserId,
      action: "platform.impersonation.ended",
      entityType: "impersonation_session",
      entityId: payload.sessionId,
      metadata: {
        targetUserId: payload.targetUserId,
        reason: payload.reason,
        durationMs,
      },
      ipAddress: getClientIp(request),
    });

    return Response.json({ ok: true, wasImpersonating: true });
  });
}
