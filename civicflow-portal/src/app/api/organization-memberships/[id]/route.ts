import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const updateMembershipSchema = z.object({
  role: z.enum(["ORG_OWNER", "ORG_ADMIN", "FINANCE", "STAFF", "READ_ONLY"]).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("users:manage", "throw");
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

    const updated = await prisma.organizationMembership.update({
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
    const { session, organizationId } = await requirePermission("users:manage", "throw");
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
