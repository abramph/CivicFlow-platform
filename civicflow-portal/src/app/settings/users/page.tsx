import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { UsersAndRolesManager } from "@/components/forms/UsersAndRolesManager";

export default async function UsersSettingsPage() {
  const { organizationId, role, session, can } = await requirePermission("users:read");
  const canManage = can("users:manage");

  const memberships = await prisma.organizationMembership.findMany({
    where: { organizationId },
    orderBy: [{ joinedAt: "asc" }],
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

  const roleCounts = memberships.reduce<Record<string, number>>((counts, membership) => {
    counts[membership.role] = (counts[membership.role] ?? 0) + 1;
    return counts;
  }, {});

  return (
    <main className="space-y-6">
      <PageHeader
        title="Users & Roles"
        description="Invite organization users, update their role assignments, and remove access while preserving SaaS audit coverage."
        actions={[
          { href: "/settings", label: "Settings Hub" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Your Role" value={role} />
        <StatCard label="Users" value={memberships.length} />
        <StatCard label="Admins / Owners" value={(roleCounts.ORG_OWNER ?? 0) + (roleCounts.ORG_ADMIN ?? 0)} />
        <StatCard label="Finance + Staff" value={(roleCounts.FINANCE ?? 0) + (roleCounts.STAFF ?? 0)} />
      </div>

      <SectionCard title="Access Management" description="Role changes and removals flow through the protected organization membership API and stay scoped to the active organization.">
        <UsersAndRolesManager
          memberships={memberships.map((membership) => ({
            ...membership,
            joinedAt: membership.joinedAt.toISOString(),
            user: {
              ...membership.user,
              createdAt: membership.user.createdAt.toISOString(),
            },
          }))}
          currentUserId={session.userId}
          canManage={canManage}
          actorRole={role}
        />
      </SectionCard>
    </main>
  );
}
