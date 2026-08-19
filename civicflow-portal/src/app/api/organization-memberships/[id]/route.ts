import { requirePermission, roleRank } from "@/lib/auth-guards";
import type { Role } from "@/lib/rbac";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { lockAndAssertAdminSeatAvailable } from "@/lib/admin-seats";
import { roleRequiresAdministrativeSeat } from "@/lib/admin-seat-policy";

const updateMembershipSchema = z.object({
  role: z.enum(["ORG_OWNER", "ORG_ADMIN", "FINANCE", "STAFF", "READ_ONLY"]).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId, role: actorRole } = await requirePermission("users:manage", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, updateMembershipSchema);

    const existing = await prisma.organizationMembership.findFirst({
      where: { id, organizationId },
      include: { user: true },
    });

    if (!existing) {
      return Response.json({ ok: false, error: "Membership not found" }, { status: 404 });
    }

    if (!input.role) {
      throw new ValidationError("A role update is required.");
    }

    // Rank check is independent of the (now org-customizable) "users:manage"
    // permission — without it, an ORG_ADMIN, or any role an owner has granted
    // users:manage to via the permission editor, could grant itself or anyone
    // else ORG_OWNER. Nobody may assign a role above their own rank, or modify
    // a membership that already outranks them.
    if (roleRank(input.role as Role) > roleRank(actorRole)) {
      throw new ValidationError("You cannot assign a role higher than your own.");
    }
    if (roleRank(existing.role as Role) > roleRank(actorRole)) {
      throw new ValidationError("You cannot modify a member whose role is higher than your own.");
    }

    // Seat-neutral in every case except an actual promotion out of a
    // non-seat-consuming role into a seat-consuming one — a lateral move
    // between two seat-consuming roles, or a demotion, never touches the
    // seat pool and must not be blocked by it.
    const [existingRequiresSeat, nextRequiresSeat] = await Promise.all([
      roleRequiresAdministrativeSeat(organizationId, existing.role as Role),
      roleRequiresAdministrativeSeat(organizationId, input.role as Role),
    ]);
    const isNewSeatConsumption = !existingRequiresSeat && nextRequiresSeat;

    const updated = await prisma.$transaction(async (tx) => {
      if (isNewSeatConsumption) {
        await lockAndAssertAdminSeatAvailable(tx, organizationId);
      }
      return tx.organizationMembership.update({
        where: { id },
        data: { role: input.role },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
              createdAt: true,
            },
          },
        },
      });
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "update",
      entityType: "organization_membership",
      entityId: updated.id,
      metadata: {
        before: existing.role,
        after: updated.role,
      },
    });

    return Response.json({ ok: true, data: updated });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId, role: actorRole } = await requirePermission("users:manage", "throw");
    const { id } = await params;

    const existing = await prisma.organizationMembership.findFirst({
      where: { id, organizationId },
      include: { user: true },
    });

    if (!existing) {
      return Response.json({ ok: false, error: "Membership not found" }, { status: 404 });
    }

    if (existing.userId === session.userId) {
      throw new ValidationError("You cannot remove your own access from this organization.");
    }

    if (roleRank(existing.role as Role) > roleRank(actorRole)) {
      throw new ValidationError("You cannot remove a member whose role is higher than your own.");
    }

    await prisma.organizationMembership.delete({
      where: { id },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "delete",
      entityType: "organization_membership",
      entityId: id,
      metadata: {
        email: existing.user.email,
        role: existing.role,
      },
    });

    return Response.json({ ok: true });
  });
}
