import { createAuditEvent } from "@/lib/audit";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { prisma } from "@/lib/prisma";

export function calculateAge(dateOfBirth: Date | string, asOfDate: Date | string = new Date()) {
  const birthDate = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  const asOf = asOfDate instanceof Date ? asOfDate : new Date(asOfDate);

  let age = asOf.getFullYear() - birthDate.getFullYear();
  const birthdayPassed =
    asOf.getMonth() > birthDate.getMonth() ||
    (asOf.getMonth() === birthDate.getMonth() && asOf.getDate() >= birthDate.getDate());

  if (!birthdayPassed) age -= 1;
  return age;
}

export async function findMatchingMembershipCategory(
  organizationId: string,
  dateOfBirth: Date | string,
  asOfDate: Date | string = new Date()
) {
  const age = calculateAge(dateOfBirth, asOfDate);
  const asOf = asOfDate instanceof Date ? asOfDate : new Date(asOfDate);

  return prisma.category.findFirst({
    where: {
      organizationId,
      type: "MEMBERSHIP",
      isActive: true,
      autoAssignByAge: true,
      OR: [{ effectiveDate: null }, { effectiveDate: { lte: asOf } }],
      AND: [
        { OR: [{ minAge: null }, { minAge: { lte: age } }] },
        { OR: [{ maxAge: null }, { maxAge: { gte: age } }] },
      ],
    },
    orderBy: [{ priority: "desc" }, { minAge: "desc" }, { name: "asc" }],
  });
}

export async function evaluateMemberMembershipCategory(memberId: string) {
  const member = await prisma.orgMember.findUnique({
    where: { id: memberId },
    include: { membershipCategory: true },
  });

  if (!member?.dateOfBirth || member.membershipCategoryManualOverride) {
    return {
      changed: false,
      member,
      matchedCategory: null,
      reason: !member?.dateOfBirth ? "missing_dob" : "manual_override",
    };
  }

  const matchedCategory = await findMatchingMembershipCategory(
    member.organizationId,
    member.dateOfBirth
  );

  if (!matchedCategory || matchedCategory.id === member.membershipCategoryId) {
    return {
      changed: false,
      member,
      matchedCategory,
      reason: matchedCategory ? "already_assigned" : "no_match",
    };
  }

  const updated = await prisma.orgMember.update({
    where: { id: member.id },
    data: {
      membershipCategoryId: matchedCategory.id,
    },
  });

  await createAuditEvent({
    organizationId: member.organizationId,
    action: "update",
    entityType: "member",
    entityId: member.id,
    metadata: {
      reason: "membership_category_rule",
      before: {
        membershipCategoryId: member.membershipCategoryId,
      },
      after: {
        membershipCategoryId: matchedCategory.id,
      },
    },
  });

  await createMemberTimelineEvent({
    organizationId: member.organizationId,
    memberId: member.id,
    eventType: "CATEGORY_CHANGED",
    title: "Membership category auto-assigned",
    oldValue: { membershipCategoryId: member.membershipCategoryId },
    newValue: { membershipCategoryId: matchedCategory.id },
  });

  return {
    changed: true,
    member: updated,
    matchedCategory,
    reason: "updated",
  };
}

export async function applyMembershipCategoryRulesForOrganization(organizationId: string) {
  const members = await prisma.orgMember.findMany({
    where: {
      organizationId,
      dateOfBirth: { not: null },
      membershipCategoryManualOverride: false,
    },
    select: { id: true },
  });

  let changed = 0;
  let matched = 0;

  for (const member of members) {
    const result = await evaluateMemberMembershipCategory(member.id);
    if (result.matchedCategory) matched += 1;
    if (result.changed) changed += 1;
  }

  return {
    evaluated: members.length,
    matched,
    changed,
  };
}
