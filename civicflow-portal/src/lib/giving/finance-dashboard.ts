import { prisma } from "@/lib/prisma";
import { ensureContributionsEnabled } from "./module";

/**
 * CORE-GIVE-I (§37) — the organization finance dashboard. AGGREGATES ONLY:
 * everything here is org-level totals; individual giving stays behind
 * contributions:individual:view on its own surfaces. Read-only.
 */

/** Normalize a schedule's amount to a monthly run rate (§37). */
export function monthlyRunRate(amount: number, frequency: string): number {
  switch (frequency) {
    case "WEEKLY":
      return (amount * 52) / 12;
    case "BIWEEKLY":
      return (amount * 26) / 12;
    case "MONTHLY":
      return amount;
    case "QUARTERLY":
      return amount / 3;
    case "ANNUALLY":
      return amount / 12;
    default:
      return 0;
  }
}

export interface FinanceDashboard {
  thisMonth: number;
  yearToDate: number;
  activeRecurringContributors: number;
  recurringMonthlyRunRate: number;
  pledgedTotal: number;
  receivedTowardPledges: number;
  failedNeedingAttention: number;
  topFunds: { name: string; total: number }[];
}

export async function getFinanceDashboard(organizationId: string): Promise<FinanceDashboard> {
  await ensureContributionsEnabled(organizationId);

  const now = new Date();
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nonVoid = { organizationId, voidedAt: null } as const;

  const [monthAgg, ytdAgg, activeSchedules, pledgeAgg, pledgeReceivedAgg, failedCount, fundTotals] = await Promise.all([
    prisma.contribution.aggregate({
      where: { ...nonVoid, contributionDate: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.contribution.aggregate({
      where: { ...nonVoid, contributionDate: { gte: yearStart } },
      _sum: { amount: true },
    }),
    prisma.recurringContributionSchedule.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { amount: true, frequency: true, contributorUserId: true },
    }),
    prisma.pledge.aggregate({
      where: { organizationId, status: { in: ["ACTIVE", "FULFILLED"] } },
      _sum: { pledgedAmount: true },
    }),
    prisma.contribution.aggregate({
      where: { ...nonVoid, pledgeId: { not: null } },
      _sum: { amount: true },
    }),
    prisma.recurringContributionSchedule.count({
      where: { organizationId, status: { in: ["PAYMENT_FAILED", "PAYMENT_ACTION_REQUIRED"] } },
    }),
    prisma.contribution.groupBy({
      by: ["fundId"],
      where: { ...nonVoid, fundId: { not: null }, contributionDate: { gte: yearStart } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
      take: 5,
    }),
  ]);

  const fundIds = fundTotals.map((row) => row.fundId).filter((id): id is string => id !== null);
  const funds = fundIds.length
    ? await prisma.fund.findMany({ where: { id: { in: fundIds }, organizationId }, select: { id: true, name: true } })
    : [];
  const fundName = new Map(funds.map((fund) => [fund.id, fund.name]));

  return {
    thisMonth: Number(monthAgg._sum.amount ?? 0),
    yearToDate: Number(ytdAgg._sum.amount ?? 0),
    activeRecurringContributors: new Set(activeSchedules.map((schedule) => schedule.contributorUserId)).size,
    recurringMonthlyRunRate: activeSchedules.reduce(
      (sum, schedule) => sum + monthlyRunRate(Number(schedule.amount), schedule.frequency),
      0
    ),
    pledgedTotal: Number(pledgeAgg._sum.pledgedAmount ?? 0),
    receivedTowardPledges: Number(pledgeReceivedAgg._sum.amount ?? 0),
    failedNeedingAttention: failedCount,
    topFunds: fundTotals.map((row) => ({
      name: fundName.get(row.fundId as string) ?? "—",
      total: Number(row._sum.amount ?? 0),
    })),
  };
}
