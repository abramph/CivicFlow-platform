import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
  /** Null for platform-level actions with no owning organization (e.g. SUPER_ADMIN SMS Administration changes). */
  organizationId: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Lightweight audit helper for API routes.
 */
export async function createAuditEvent(input: CreateAuditEventInput) {
  return prisma.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorUserId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      resource: input.entityType,
      resourceId: input.entityId ?? null,
      after: input.metadata ?? undefined,
    },
  });
}
