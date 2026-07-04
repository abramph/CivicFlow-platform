import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type DuesPlan = {
  accountId: string;
  amount: number;
  frequency: string;
};

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function firstOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

function addFrequency(date: Date, frequency: string) {
  const normalized = frequency.toLowerCase();
  if (normalized.includes("year") || normalized.includes("annual")) return addMonths(date, 12);
  if (normalized.includes("quarter")) return addMonths(date, 3);
  if (normalized.includes("week")) {
    const next = new Date(date);
    next.setDate(next.getDate() + 7);
    return next;
  }
  return addMonths(date, 1);
}

function periodEndFromStart(periodStart: Date, frequency: string) {
  const nextStart = addFrequency(periodStart, frequency);
  const end = new Date(nextStart);
  end.setDate(end.getDate() - 1);
  end.setHours(23, 59, 59, 999);
  return end;
}

async function getSettings(organizationId: string) {
  return prisma.orgSettings.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId },
  });
}

async function resolveDuesPlan(memberId: string): Promise<DuesPlan | null> {
  const member = await prisma.orgMember.findFirst({
    where: { id: memberId },
    include: {
      membershipCategory: {
        include: { standardDuesCategory: true },
      },
      duesAccounts: {
        where: { isActive: true },
        orderBy: [{ memberId: "desc" }, { createdAt: "asc" }],
        take: 1,
      },
    },
  });

  if (!member) return null;

  const memberAccount = member.duesAccounts[0];
  if (memberAccount) {
    return {
      accountId: memberAccount.id,
      amount: Number(memberAccount.amountDefault ?? 0),
      frequency: memberAccount.frequency,
    };
  }

  const duesCategory = member.membershipCategory?.standardDuesCategory;
  if (!duesCategory) return null;

  const sharedAccount = await prisma.duesAccount.findFirst({
    where: {
      organizationId: member.organizationId,
      categoryId: duesCategory.id,
      memberId: null,
      isActive: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (sharedAccount) {
    return {
      accountId: sharedAccount.id,
      amount: Number(sharedAccount.amountDefault ?? duesCategory.amountDefault ?? 0),
      frequency: sharedAccount.frequency || duesCategory.frequency || "monthly",
    };
  }

  const createdAccount = await prisma.duesAccount.create({
    data: {
      organizationId: member.organizationId,
      name: `${duesCategory.name} Dues`,
      categoryId: duesCategory.id,
      amountDefault: duesCategory.amountDefault ?? new Prisma.Decimal(0),
      frequency: duesCategory.frequency || "monthly",
      isActive: true,
      notes: "Generated from membership category dues plan.",
    },
  });

  return {
    accountId: createdAccount.id,
    amount: Number(createdAccount.amountDefault ?? 0),
    frequency: createdAccount.frequency,
  };
}

async function getAccrualStart(memberId: string, requestedStart?: Date) {
  const member = await prisma.orgMember.findFirst({ where: { id: memberId } });
  if (!member) throw new Error("Member not found");
  const settings = await getSettings(member.organizationId);
  const joinDate = member.joinDate ? startOfDay(member.joinDate) : startOfDay(member.createdAt);
  let policyStart = joinDate;
  if (settings.duesStartRule === "FIRST_OF_NEXT_MONTH") {
    policyStart = firstOfMonth(addMonths(joinDate, 1));
  }
  if (settings.duesStartRule === "MANUAL" && requestedStart) {
    policyStart = startOfDay(requestedStart);
  }
  const start = requestedStart && requestedStart > policyStart ? startOfDay(requestedStart) : policyStart;

  // Hard floor, independent of duesStartRule and whether a start date was
  // supplied — prevents retroactively billing members for periods before
  // this org's dues history is actually known (e.g. a desktop→cloud
  // migration that didn't import a per-member charge ledger).
  if (settings.duesAccrualNotBeforeDate && start < settings.duesAccrualNotBeforeDate) {
    return startOfDay(settings.duesAccrualNotBeforeDate);
  }
  return start;
}

async function buildExpectedPeriods(memberId: string, startDate: Date, endDate: Date) {
  const plan = await resolveDuesPlan(memberId);
  if (!plan) return [];

  const periods: Array<{ duesAccountId: string; periodStart: Date; periodEnd: Date; amountDue: number; dueDate: Date }> = [];
  let cursor = await getAccrualStart(memberId, startDate);
  const stop = startOfDay(endDate);

  while (cursor <= stop) {
    const periodStart = startOfDay(cursor);
    const periodEnd = periodEndFromStart(periodStart, plan.frequency);
    if (periodEnd >= startDate && periodStart <= stop) {
      periods.push({
        duesAccountId: plan.accountId,
        periodStart,
        periodEnd,
        amountDue: plan.amount,
        dueDate: periodEnd,
      });
    }
    cursor = addFrequency(periodStart, plan.frequency);
  }

  return periods;
}

export async function calculateExpectedDuesForMember(memberId: string, startDate: Date, endDate: Date) {
  const periods = await buildExpectedPeriods(memberId, startDate, endDate);
  return {
    periods,
    expectedAmount: periods.reduce((sum, period) => sum + period.amountDue, 0),
  };
}

export async function calculateDuesFromJoinDate(memberId: string, asOfDate = new Date()) {
  const startDate = await getAccrualStart(memberId);
  return calculateExpectedDuesForMember(memberId, startDate, asOfDate);
}

export async function calculateOutstandingDues(memberId: string) {
  const [charges, adjustments] = await Promise.all([
    prisma.duesCharge.findMany({
      where: { memberId, status: { notIn: ["PAID", "VOID"] } },
      select: { id: true, amountDue: true, amountPaid: true },
    }),
    prisma.duesAdjustment.groupBy({
      by: ["duesChargeId"],
      where: { memberId },
      _sum: { amount: true },
    }),
  ]);
  const adjustmentByCharge = new Map(adjustments.map((row) => [row.duesChargeId, Number(row._sum.amount ?? 0)]));
  const outstanding = charges.reduce((sum, charge) => {
    const adjusted = adjustmentByCharge.get(charge.id) ?? 0;
    return sum + Math.max(0, Number(charge.amountDue) - Number(charge.amountPaid) - adjusted);
  }, 0);
  return { outstanding, openChargeCount: charges.length };
}

export async function generateMissingDuesChargesForMember(memberId: string, asOfDate = new Date(), startDate?: Date) {
  const member = await prisma.orgMember.findFirst({ where: { id: memberId } });
  if (!member) throw new Error("Member not found");

  const effectiveStart = startDate ?? (await getAccrualStart(memberId));
  const periods = await buildExpectedPeriods(memberId, effectiveStart, asOfDate);
  const generated = [];
  const skipped = [];

  for (const period of periods) {
    if (period.amountDue <= 0) {
      skipped.push({ ...period, reason: "zero_amount" });
      continue;
    }

    const existing = await prisma.duesCharge.findFirst({
      where: {
        organizationId: member.organizationId,
        memberId,
        duesAccountId: period.duesAccountId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
      },
    });

    if (existing) {
      skipped.push({ ...period, reason: "existing", existingId: existing.id });
      continue;
    }

    generated.push(
      await prisma.duesCharge.create({
        data: {
          organizationId: member.organizationId,
          memberId,
          duesAccountId: period.duesAccountId,
          amountDue: period.amountDue,
          dueDate: period.dueDate,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          status: "PENDING",
          notes: "Generated from dues accrual.",
        },
      })
    );
  }

  return { generated, skipped, periods };
}

export async function generateMissingDuesChargesForOrganization(organizationId: string, asOfDate = new Date(), startDate?: Date) {
  const members = await prisma.orgMember.findMany({
    where: { organizationId, membershipStatus: { in: ["active", "pending"] } },
    select: { id: true },
  });

  let generatedCount = 0;
  let skippedCount = 0;
  for (const member of members) {
    const result = await generateMissingDuesChargesForMember(member.id, asOfDate, startDate);
    generatedCount += result.generated.length;
    skippedCount += result.skipped.length;
  }

  return { memberCount: members.length, generatedCount, skippedCount };
}
