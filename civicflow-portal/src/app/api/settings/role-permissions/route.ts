import type { OrgRole } from "@prisma/client";
import { requireRole } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import {
  ALL_PERMISSIONS,
  CUSTOMIZABLE_ROLES,
  defaultPermissionsFor,
  getEffectivePermissions,
  isCustomizableRole,
} from "@/lib/role-permissions";

// Only an ORG_OWNER may reconfigure what other roles in their org can do —
// gating this behind a permission string (rather than the role rank check
// requireRole gives us) would let an ORG_ADMIN grant itself more access.
async function requireOwner(onForbidden: "redirect" | "throw" = "throw") {
  return requireRole("ORG_OWNER", onForbidden);
}

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireOwner();

    const overrides = await prisma.orgRolePermissionSet.findMany({
      where: { organizationId, role: { in: CUSTOMIZABLE_ROLES as unknown as OrgRole[] } },
    });
    const overrideByRole = new Map(overrides.map((row) => [row.role, row]));

    const roles = await Promise.all(
      CUSTOMIZABLE_ROLES.map(async (role) => ({
        role,
        permissions: await getEffectivePermissions(organizationId, role),
        defaultPermissions: defaultPermissionsFor(role),
        isCustomized: overrideByRole.has(role),
      }))
    );

    return Response.json({ ok: true, data: { roles, allPermissions: ALL_PERMISSIONS } });
  });
}

const updateSchema = z.object({
  role: z.enum(CUSTOMIZABLE_ROLES as unknown as [string, ...string[]]),
  permissions: z.array(z.string()),
});

export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requireOwner();
    const input = await parseJsonBody(request, updateSchema);

    if (!isCustomizableRole(input.role)) {
      throw new ValidationError(`Role ${input.role} cannot be customized.`);
    }

    const invalid = input.permissions.filter((permission) => !(ALL_PERMISSIONS as string[]).includes(permission));
    if (invalid.length > 0) {
      throw new ValidationError("Unknown permission(s) in request.", { invalid });
    }

    const before = await getEffectivePermissions(organizationId, input.role);

    const updated = await prisma.orgRolePermissionSet.upsert({
      where: { organizationId_role: { organizationId, role: input.role } },
      create: {
        organizationId,
        role: input.role,
        permissions: input.permissions,
        updatedByUserId: session.userId,
      },
      update: {
        permissions: input.permissions,
        updatedByUserId: session.userId,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "update",
      entityType: "org_role_permission_set",
      entityId: updated.id,
      metadata: { role: input.role, before, after: input.permissions },
    });

    return Response.json({ ok: true, data: updated });
  });
}

const resetSchema = z.object({
  role: z.enum(CUSTOMIZABLE_ROLES as unknown as [string, ...string[]]),
});

export async function DELETE(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requireOwner();
    const input = await parseJsonBody(request, resetSchema);

    if (!isCustomizableRole(input.role)) {
      throw new ValidationError(`Role ${input.role} cannot be customized.`);
    }

    const existing = await prisma.orgRolePermissionSet.findUnique({
      where: { organizationId_role: { organizationId, role: input.role } },
    });

    if (!existing) {
      return Response.json({ ok: true, data: { role: input.role, permissions: defaultPermissionsFor(input.role) } });
    }

    await prisma.orgRolePermissionSet.delete({
      where: { organizationId_role: { organizationId, role: input.role } },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "delete",
      entityType: "org_role_permission_set",
      entityId: existing.id,
      metadata: { role: input.role, restoredDefault: defaultPermissionsFor(input.role) },
    });

    return Response.json({ ok: true, data: { role: input.role, permissions: defaultPermissionsFor(input.role) } });
  });
}
