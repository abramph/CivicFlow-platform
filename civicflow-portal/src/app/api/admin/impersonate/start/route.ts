import { randomUUID } from "crypto";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { beginImpersonationCookies } from "@/lib/impersonation";
import { ACTIVE_ORG_COOKIE } from "@/lib/org-context";
import { getClientIp } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { cookies } from "next/headers";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  targetUserId: z.string().min(1),
  reason: z.string().max(500).nullable().optional(),
});

/**
 * Starts an impersonation session. Guarded by requireSuperAdmin() — note
 * that if this is called while ALREADY impersonating, requireSuperAdmin()
 * will itself fail, because at that point getServerSession() resolves
 * hasPlatformAccess for the TARGET user (an ordinary member, not a platform
 * admin) rather than the real admin. Nested impersonation is therefore
 * rejected as a natural consequence of the session overlay design, not a
 * separate check bolted on here.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const { organizationId, targetUserId, reason } = await parseJsonBody(request, bodySchema);

    const membership = await prisma.organizationMembership.findFirst({
      where: { userId: targetUserId, organizationId, status: "active" },
      include: { organization: { select: { name: true, status: true } }, user: { select: { email: true, displayName: true } } },
    });
    if (!membership || membership.organization.status !== "active") {
      return Response.json({ ok: false, error: "That user is not an active member of that organization." }, { status: 400 });
    }

    const priorActiveOrgId = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value ?? null;
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();

    await beginImpersonationCookies({
      actorUserId: session.userId,
      targetUserId,
      organizationId,
      sessionId,
      startedAt,
      reason: reason ?? null,
      priorActiveOrgId,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "platform.impersonation.started",
      entityType: "impersonation_session",
      entityId: sessionId,
      metadata: {
        targetUserId,
        targetEmail: membership.user.email,
        targetDisplayName: membership.user.displayName,
        organizationName: membership.organization.name,
        reason: reason ?? null,
      },
      ipAddress: getClientIp(request),
    });

    return Response.json({ ok: true });
  });
}
