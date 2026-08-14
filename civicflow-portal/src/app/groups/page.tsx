import { requirePermission } from "@/lib/auth-guards";
import { listGroups } from "@/lib/groups";
import { getEffectiveCategory, CATEGORY_INFO } from "@/lib/organization-category";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { GroupsManager } from "@/components/groups/GroupsManager";

/**
 * CORE-GIVE-I (§40/§41) — core groups: ministries, committees, chapters.
 * The page label follows the organization's category ("Ministries" for a
 * church); the database concept stays "group".
 */
export default async function GroupsPage() {
  const { organizationId, session, can } = await requirePermission("groups:view");

  const [organization, groups, members] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { primaryVertical: true, category: true },
    }),
    listGroups(organizationId),
    prisma.orgMember.findMany({
      where: { organizationId, membershipStatus: "active" },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, userId: true },
      take: 500,
    }),
  ]);

  const category = getEffectiveCategory(organization?.primaryVertical ?? "COMMUNITY", organization?.category);
  const groupsLabel = CATEGORY_INFO[category].groupsLabel;
  const myMemberIds = members.filter((member) => member.userId === session.userId).map((member) => member.id);

  return (
    <main className="space-y-6">
      <PageHeader
        title={groupsLabel}
        description="Organize your people into groups with their own leaders. A group leader manages only their group's roster — leadership never grants financial access."
      />
      <SectionCard title={`All ${groupsLabel.toLowerCase()}`} description="Groups are archived, never deleted.">
        <GroupsManager
          groupsLabel={groupsLabel}
          groups={groups.map((group) => ({
            id: group.id,
            name: group.name,
            description: group.description,
            kindLabel: group.kindLabel,
            status: group.status,
            members: group.members.map((row) => ({
              id: row.member.id,
              name: `${row.member.firstName} ${row.member.lastName}`.trim(),
              isLeader: row.isLeader,
            })),
            callerLeads: group.members.some((row) => row.isLeader && myMemberIds.includes(row.member.id)),
          }))}
          members={members.map((member) => ({ id: member.id, name: `${member.firstName} ${member.lastName}`.trim() }))}
          viewer={{
            canManage: can("groups:manage"),
            canManageMembers: can("groups:members:manage"),
          }}
        />
      </SectionCard>
    </main>
  );
}
