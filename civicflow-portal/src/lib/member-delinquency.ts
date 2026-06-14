import { createAuditEvent } from "@/lib/audit";
import { createMemberTimelineEvent } from "@/lib/member-timeline";
import { prisma } from "@/lib/prisma";

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export async function evaluateMemberDelinquency(
  memberId: string,
  options: { actorUserId?: string | null; actorEmail?: string | null; asOfDate?: Date } = {}
) {
  const asOfDate = options.asOfDate ?? new Date();
  const member = await prisma.orgMember.findFirst({ where: { id: memberId } });
  if (!member) throw new Error("Member not found");

  const settings = await prisma.orgSettings.upsert({
    where: { organizationId: member.organizationId },
    update: {},
    create: { organizationId: member.organizationId },
  });

  const openCharges = await prisma.duesCharge.findMany({
    where: {
      organizationId: member.organizationId,
      memberId,
      status: { in: ["PENDING", "PARTIAL"] },
    },
    include: { adjustments: true },
    orderBy: { dueDate: "asc" },
  });

  const overdueCharges = openCharges.filter((charge) => {
    const adjusted = charge.adjustments.reduce((sum, adjustment) => sum + Number(adjustment.amount), 0);
    const balance = Number(charge.amountDue) - Number(charge.amountPaid) - adjusted;
    return balance > 0 && addDays(charge.dueDate, settings.gracePeriodDays) < asOfDate;
  });

  const unpaidPeriods = overdueCharges.length;
  const oldestDueDate = overdueCharges[0]?.dueDate ?? null;
  const delinquentByMonths = unpaidPeriods >= settings.delinquentAfterMonths;
  const delinquentByDays =
    Boolean(settings.delinquentAfterDays && oldestDueDate) &&
    addDays(oldestDueDate as Date, settings.delinquentAfterDays ?? 0) < asOfDate;
  const shouldBeDelinquent = settings.autoMarkDelinquent && (delinquentByMonths || delinquentByDays);
  const delinquentSince = shouldBeDelinquent ? member.delinquentSince ?? oldestDueDate ?? asOfDate : null;

  const updated = await prisma.orgMember.update({
    where: { id: member.id },
    data: {
      isDelinquent: shouldBeDelinquent,
      delinquentSince,
      lastDuesEvaluationAt: asOfDate,
    },
  });

  if (member.isDelinquent !== shouldBeDelinquent) {
    await createMemberTimelineEvent({
      organizationId: member.organizationId,
      memberId: member.id,
      eventType: "UPDATED",
      title: shouldBeDelinquent ? "Member marked delinquent" : "Member delinquency cleared",
      oldValue: { isDelinquent: member.isDelinquent, delinquentSince: member.delinquentSince?.toISOString() ?? null },
      newValue: { isDelinquent: updated.isDelinquent, delinquentSince: updated.delinquentSince?.toISOString() ?? null, unpaidPeriods },
      createdByUserId: options.actorUserId ?? null,
    });

    await createAuditEvent({
      organizationId: member.organizationId,
      actorUserId: options.actorUserId,
      actorEmail: options.actorEmail,
      action: "dues.delinquency",
      entityType: "member",
      entityId: member.id,
      metadata: {
        isDelinquent: shouldBeDelinquent,
        unpaidPeriods,
        delinquentSince: delinquentSince?.toISOString() ?? null,
      },
    });
  }

  return {
    member: updated,
    unpaidPeriods,
    oldestDueDate,
    isDelinquent: shouldBeDelinquent,
  };
}

export async function evaluateOrganizationDelinquency(
  organizationId: string,
  options: { actorUserId?: string | null; actorEmail?: string | null; asOfDate?: Date } = {}
) {
  const members = await prisma.orgMember.findMany({
    where: { organizationId, membershipStatus: { in: ["active", "pending", "suspended"] } },
    select: { id: true },
  });

  let delinquentCount = 0;
  for (const member of members) {
    const result = await evaluateMemberDelinquency(member.id, options);
    if (result.isDelinquent) delinquentCount += 1;
  }

  return { evaluatedCount: members.length, delinquentCount };
}
