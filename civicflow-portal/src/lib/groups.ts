import { prisma } from "@/lib/prisma";
import { FinanceError } from "@/lib/finance-errors";

/**
 * CORE-GIVE-I (§40/§41) — generic core groups (ministries, committees,
 * chapters). THE RULES:
 *  - groups archive, never delete;
 *  - a group LEADER manages only their own group's membership — leadership
 *    is verified from the caller's own OrgGroupMember row, never a client
 *    claim;
 *  - this module never imports giving code and grants nothing financial:
 *    group capabilities are disjoint from every contributions:* capability
 *    (asserted in tests, §111.3).
 */

interface ActorInput {
  actorUserId: string;
  actorEmail?: string | null;
}

async function audit(organizationId: string, actor: ActorInput, action: string, groupId: string, metadata: Record<string, string | null>) {
  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId,
    actorUserId: actor.actorUserId,
    actorEmail: actor.actorEmail ?? null,
    action,
    entityType: "org_group",
    entityId: groupId,
    metadata,
  });
}

export async function listGroups(organizationId: string) {
  return prisma.orgGroup.findMany({
    where: { organizationId },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      members: {
        orderBy: [{ isLeader: "desc" }, { createdAt: "asc" }],
        include: { member: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
    take: 500,
  });
}

export async function createGroup(input: ActorInput & {
  organizationId: string;
  name: string;
  description?: string | null;
  kindLabel?: string | null;
}) {
  const name = input.name.trim();
  if (!name) throw new FinanceError("Group name is required.");
  try {
    const group = await prisma.orgGroup.create({
      data: {
        organizationId: input.organizationId,
        name,
        description: input.description?.trim() || null,
        kindLabel: input.kindLabel?.trim() || "Group",
      },
    });
    await audit(input.organizationId, input, "groups.created", group.id, { name, kindLabel: group.kindLabel });
    return group;
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      throw new FinanceError(`A group named "${name}" already exists.`, 409);
    }
    throw error;
  }
}

export async function updateGroup(input: ActorInput & {
  organizationId: string;
  groupId: string;
  name?: string;
  description?: string | null;
  kindLabel?: string;
  status?: "ACTIVE" | "ARCHIVED";
}) {
  const group = await prisma.orgGroup.findFirst({ where: { id: input.groupId, organizationId: input.organizationId } });
  if (!group) throw new FinanceError("Group not found.", 404);
  const updated = await prisma.orgGroup.update({
    where: { id: group.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.kindLabel !== undefined ? { kindLabel: input.kindLabel.trim() || "Group" } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
  await audit(input.organizationId, input, input.status === "ARCHIVED" ? "groups.archived" : "groups.updated", group.id, {
    name: updated.name,
    status: updated.status,
  });
  return updated;
}

/** §41 leadership check: is this user a LEADER of this group, via their own
 * membership rows? Server-derived, org-scoped, never a client claim. */
export async function isGroupLeader(organizationId: string, groupId: string, userId: string): Promise<boolean> {
  const row = await prisma.orgGroupMember.findFirst({
    where: {
      groupId,
      isLeader: true,
      group: { organizationId, status: "ACTIVE" },
      member: { organizationId, userId },
    },
    select: { id: true },
  });
  return row !== null;
}

export async function setGroupMembership(input: ActorInput & {
  organizationId: string;
  groupId: string;
  memberId: string;
  action: "add" | "remove" | "make-leader" | "remove-leader";
}) {
  const group = await prisma.orgGroup.findFirst({ where: { id: input.groupId, organizationId: input.organizationId } });
  if (!group) throw new FinanceError("Group not found.", 404);
  if (group.status === "ARCHIVED") throw new FinanceError("An archived group's membership cannot change.", 409);
  const member = await prisma.orgMember.findFirst({ where: { id: input.memberId, organizationId: input.organizationId } });
  if (!member) throw new FinanceError("Member not found.", 404);

  if (input.action === "add") {
    await prisma.orgGroupMember.upsert({
      where: { groupId_memberId: { groupId: group.id, memberId: member.id } },
      create: { groupId: group.id, memberId: member.id },
      update: {},
    });
  } else if (input.action === "remove") {
    await prisma.orgGroupMember.deleteMany({ where: { groupId: group.id, memberId: member.id } });
  } else {
    const existing = await prisma.orgGroupMember.findUnique({
      where: { groupId_memberId: { groupId: group.id, memberId: member.id } },
    });
    if (!existing) throw new FinanceError("That person is not in this group.", 404);
    await prisma.orgGroupMember.update({
      where: { id: existing.id },
      data: { isLeader: input.action === "make-leader" },
    });
  }
  await audit(input.organizationId, input, `groups.member_${input.action.replace("-", "_")}`, group.id, {
    memberId: member.id,
  });
}
