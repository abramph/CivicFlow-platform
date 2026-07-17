import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { RolePermissionsManager } from "@/components/forms/RolePermissionsManager";
import {
  ALL_PERMISSIONS,
  CUSTOMIZABLE_ROLES,
  defaultPermissionsFor,
  getEffectivePermissions,
} from "@/lib/role-permissions";

export default async function RolePermissionsPage() {
  const { organizationId } = await requireRole("ORG_OWNER");

  const overrides = await prisma.orgRolePermissionSet.findMany({
    where: { organizationId, role: { in: [...CUSTOMIZABLE_ROLES] } },
  });
  const overriddenRoles = new Set(overrides.map((row) => row.role));

  const roles = await Promise.all(
    CUSTOMIZABLE_ROLES.map(async (role) => ({
      role,
      permissions: await getEffectivePermissions(organizationId, role),
      defaultPermissions: defaultPermissionsFor(role),
      isCustomized: overriddenRoles.has(role),
    }))
  );

  return (
    <main className="space-y-6">
      <PageHeader
        title="Role Permissions"
        description="Customize exactly what each staff role can see and do in your organization. Owner always has full access and cannot be changed here; Member accounts always have zero staff access."
        actions={[
          { href: "/settings/users", label: "Users & Roles" },
          { href: "/settings", label: "Settings Hub" },
        ]}
      />
      <SectionCard
        title="Customizable Roles"
        description="Check the boxes for what each role should be allowed to do. Changes apply immediately to everyone assigned that role in your organization."
      >
        <RolePermissionsManager roles={roles} allPermissions={ALL_PERMISSIONS} />
      </SectionCard>
    </main>
  );
}
