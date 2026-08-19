/**
 * Unestra Cloud — Administrative Seat Override management (CLOUD-SEAT-E)
 *
 * The only supported way to change Organization.adminSeatOverride outside of
 * CLOUD-SEAT-D's grandfathering pass. Deliberately NOT reachable from any
 * org-facing route — every call site must come through a platform-admin
 * (requireSuperAdmin-guarded) API route, so an org's own admins can never
 * edit their own override. Every change is fully audited with actor,
 * reason, before/after values, and timestamp via createAuditEvent.
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { getAdminSeatSummary } from "@/lib/admin-seats";

type Db = PrismaClient | Prisma.TransactionClient;

export class AdminSeatOverrideError extends Error {
  readonly status = 400;
  readonly code = "ADMIN_SEAT_OVERRIDE_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "AdminSeatOverrideError";
  }
}

interface OverrideActorContext {
  organizationId: string;
  reason: string;
  actorUserId: string;
  actorEmail: string;
  /** null = no expiration (permanent until explicitly changed/removed). */
  expiresAt: Date | null;
}

/**
 * Grants a new override or changes an existing one to `newOverride` seats.
 * Rejects negative values outright — this is the one place in the system a
 * negative override could ever be introduced, so it's the one place that
 * must refuse it. `reason` is required and always recorded.
 */
export async function setAdminSeatOverride(
  input: OverrideActorContext & { newOverride: number },
  db: Db = prisma
): Promise<{ before: number; after: number }> {
  if (!Number.isInteger(input.newOverride) || input.newOverride < 0) {
    throw new AdminSeatOverrideError("Administrative seat override cannot be negative.");
  }
  if (!input.reason.trim()) {
    throw new AdminSeatOverrideError("A reason is required to grant or change an administrative seat override.");
  }

  const before = await db.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
    select: { adminSeatOverride: true },
  });

  await db.organization.update({
    where: { id: input.organizationId },
    data: {
      adminSeatOverride: input.newOverride,
      adminSeatOverrideReason: input.reason.trim(),
      adminSeatOverrideExpiresAt: input.expiresAt,
      adminSeatOverrideSetByUserId: input.actorUserId,
      adminSeatOverrideSetAt: new Date(),
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: before.adminSeatOverride === 0 ? "ADMIN_SEAT_OVERRIDE_GRANTED" : "ADMIN_SEAT_OVERRIDE_CHANGED",
    entityType: "organization_admin_seat_override",
    entityId: input.organizationId,
    metadata: {
      reason: input.reason.trim(),
      before: before.adminSeatOverride,
      after: input.newOverride,
      expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
    },
  });

  return { before: before.adminSeatOverride, after: input.newOverride };
}

/**
 * Removes an override entirely (back to 0, no expiration, no reason kept).
 * An org whose usage was only staying within limit because of this override
 * will start showing overLimit — per the brief, that never demotes or
 * removes any existing administrator; it only blocks new privileged
 * assignments (CLOUD-SEAT-C) until the org's usage naturally drops or a new
 * override is granted.
 */
export async function removeAdminSeatOverride(
  input: Omit<OverrideActorContext, "expiresAt">,
  db: Db = prisma
): Promise<{ before: number }> {
  if (!input.reason.trim()) {
    throw new AdminSeatOverrideError("A reason is required to remove an administrative seat override.");
  }

  const before = await db.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
    select: { adminSeatOverride: true },
  });

  if (before.adminSeatOverride === 0) {
    throw new AdminSeatOverrideError("This organization has no active administrative seat override to remove.");
  }

  await db.organization.update({
    where: { id: input.organizationId },
    data: {
      adminSeatOverride: 0,
      adminSeatOverrideReason: null,
      adminSeatOverrideExpiresAt: null,
      adminSeatOverrideSetByUserId: input.actorUserId,
      adminSeatOverrideSetAt: new Date(),
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: "ADMIN_SEAT_OVERRIDE_REMOVED",
    entityType: "organization_admin_seat_override",
    entityId: input.organizationId,
    metadata: { reason: input.reason.trim(), before: before.adminSeatOverride, after: 0 },
  });

  return { before: before.adminSeatOverride };
}

/** Read-only detail for the platform-admin override panel — the seat
 * summary plus who/when/why the current override (if any) was set. */
export async function getAdminSeatOverrideDetail(organizationId: string, db: Db = prisma) {
  const [summary, org] = await Promise.all([
    getAdminSeatSummary(organizationId, db),
    db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { adminSeatOverrideSetByUserId: true, adminSeatOverrideSetAt: true },
    }),
  ]);
  return { ...summary, adminSeatOverrideSetByUserId: org.adminSeatOverrideSetByUserId, adminSeatOverrideSetAt: org.adminSeatOverrideSetAt };
}
