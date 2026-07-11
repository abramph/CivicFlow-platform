import { hash } from "bcryptjs";
import { requirePermission, roleRank } from "@/lib/auth-guards";
import type { Role } from "@/lib/rbac";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { requireSeatSlot } from "@/lib/plan-gate";

const createMembershipSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1).max(160),
  role: z.enum(["ORG_OWNER", "ORG_ADMIN", "FINANCE", "STAFF", "READ_ONLY"]),
  temporaryPassword: z.string().min(10).max(120),
});

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("users:read", "throw");

    const rows = await prisma.organizationMembership.findMany({
      where: { organizationId },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
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
      action: "list",
      entityType: "organization_membership",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId, role: actorRole } = await requirePermission("users:manage", "throw");
    const input = await parseJsonBody(request, createMembershipSchema);

    if (roleRank(input.role as Role) > roleRank(actorRole)) {
      throw new ValidationError("You cannot invite someone with a role higher than your own.");
    }

    let user = await prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: input.email.trim().toLowerCase(),
          displayName: input.displayName.trim(),
          passwordHash: await hash(input.temporaryPassword, 12),
          emailVerified: false,
          mfaBackupCodes: [],
        },
      });
    } else if (!user.displayName && input.displayName.trim()) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { displayName: input.displayName.trim() },
      });
    }

    await requireSeatSlot(organizationId);

    const existingMembership = await prisma.organizationMembership.findFirst({
      where: {
        organizationId,
        userId: user.id,
      },
    });

    if (existingMembership) {
      throw new ValidationError("That user already has access to this organization.");
    }

    const membership = await prisma.organizationMembership.create({
      data: {
        organizationId,
        userId: user.id,
        role: input.role,
      },
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
      action: "create",
      entityType: "organization_membership",
      entityId: membership.id,
      metadata: {
        email: membership.user.email,
        role: membership.role,
      },
    });

    return Response.json({ ok: true, data: membership }, { status: 201 });
  });
}
