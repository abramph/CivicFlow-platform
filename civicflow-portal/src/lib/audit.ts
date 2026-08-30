import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readImpersonationCookiePayload } from "@/lib/impersonation";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "export"
  | "payment"
  | "receipt"
  | "list"
  | string;

interface CreateAuditEventInput {
  /** Null for platform-level actions with no owning organization (e.g. platform-admin SMS Administration changes, PlatformAccess grants/revocations). */
  organizationId: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  /** Pass the active `$transaction` client to have this audit insert commit
   * (or roll back) atomically with the other writes in that transaction —
   * same `PrismaClient | Prisma.TransactionClient` convention as
   * admin-seats.ts's `Db` type. Defaults to the top-level `prisma` client,
   * i.e. every existing call site's behavior is unchanged. */
  tx?: Prisma.TransactionClient;
}

/**
 * Every one of createAuditEvent()'s 200+ call sites passes session.userId as
 * actorUserId — which, during Platform Admin impersonation, IS the
 * impersonated member's id (by design: every existing guard/RBAC check is
 * meant to see the target user, not the admin). That made an admin's
 * impersonated actions indistinguishable from the member's own actions in
 * the audit log. Rather than threading a new parameter through every call
 * site, this cross-checks the actorUserId being recorded against the active
 * impersonation cookie right here, so the fix applies everywhere at once.
 * Returns null outside of a request scope (cron/background jobs, tests) or
 * when nothing is actively being impersonated — cookies() throws in those
 * contexts, which is expected and simply means "not impersonated."
 */
async function detectImpersonator(actorUserId?: string | null): Promise<{ userId: string; email: string } | null> {
  if (!actorUserId) return null;
  try {
    const payload = await readImpersonationCookiePayload();
    if (payload && payload.targetUserId === actorUserId) {
      return { userId: payload.actorUserId, email: payload.actorEmail };
    }
  } catch {
    // Not inside a request scope, or no cookie -- nothing to detect.
  }
  return null;
}

/**
 * Lightweight audit helper for API routes.
 */
export async function createAuditEvent(input: CreateAuditEventInput) {
  const impersonator = await detectImpersonator(input.actorUserId);
  const client = input.tx ?? prisma;
  return client.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorUserId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      resource: input.entityType,
      resourceId: input.entityId ?? null,
      after: input.metadata ?? undefined,
      ipAddress: input.ipAddress ?? null,
      impersonatedByUserId: impersonator?.userId ?? null,
      impersonatedByEmail: impersonator?.email ?? null,
    },
  });
}
