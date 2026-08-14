import { prisma } from "@/lib/prisma";
import { FinanceError } from "@/lib/finance-errors";
import { ensureContributionsEnabled } from "./module";
import { monthlyRunRate } from "./finance-dashboard";

/**
 * CORE-GIVE-K (§52/§53) — giving reports as uniform { columns, rows }.
 * Aggregate types need contributions:summary:view; types that NAME
 * individuals additionally need contributions:individual:view (enforced at
 * the route via requiresIndividual). CSV export additionally needs
 * contributions:export and is ALWAYS audited. Rows carry only displayed
 * fields — no provider metadata, no payment-method ids (§53).
 */

export const REPORT_TYPES = [
  "summary",
  "by-fund",
  "by-program",
  "methods",
  "recurring",
  "pledge-progress",
  "failures",
  "refunds",
  "offline",
  "year-over-year",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** Report types whose rows name individual contributors. */
export const INDIVIDUAL_REPORTS: ReportType[] = ["recurring", "pledge-progress", "failures", "refunds", "offline"];

export interface ReportResult {
  type: ReportType;
  columns: string[];
  rows: (string | number)[][];
}

interface Range {
  from: Date;
  to: Date;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function effective(amount: unknown, refunded: unknown): number {
  return Number(amount) - Number(refunded ?? 0);
}

export async function runGivingReport(
  organizationId: string,
  type: ReportType,
  range: Range,
  options: { fundId?: string | null } = {}
): Promise<ReportResult> {
  await ensureContributionsEnabled(organizationId);
  const baseWhere = {
    organizationId,
    voidedAt: null,
    contributionDate: { gte: range.from, lt: range.to },
    ...(options.fundId ? { fundId: options.fundId } : {}),
  };

  switch (type) {
    case "summary": {
      const rows = await prisma.contribution.findMany({
        where: baseWhere,
        select: { amount: true, refundedAmount: true, contributionDate: true },
      });
      const byMonth = new Map<string, { total: number; count: number }>();
      for (const row of rows) {
        const key = row.contributionDate.toISOString().slice(0, 7);
        const bucket = byMonth.get(key) ?? { total: 0, count: 0 };
        bucket.total += effective(row.amount, row.refundedAmount);
        bucket.count += 1;
        byMonth.set(key, bucket);
      }
      return {
        type,
        columns: ["Month", "Contributions", "Net amount"],
        rows: [...byMonth.entries()].sort().map(([month, bucket]) => [month, bucket.count, money(bucket.total)]),
      };
    }
    case "by-fund": {
      const rows = await prisma.contribution.findMany({
        where: baseWhere,
        select: { amount: true, refundedAmount: true, fund: { select: { name: true } } },
      });
      const byFund = new Map<string, { total: number; count: number }>();
      for (const row of rows) {
        const key = row.fund?.name ?? "(no fund)";
        const bucket = byFund.get(key) ?? { total: 0, count: 0 };
        bucket.total += effective(row.amount, row.refundedAmount);
        bucket.count += 1;
        byFund.set(key, bucket);
      }
      return {
        type,
        columns: ["Fund", "Contributions", "Net amount"],
        rows: [...byFund.entries()].sort((a, b) => b[1].total - a[1].total).map(([fund, bucket]) => [fund, bucket.count, money(bucket.total)]),
      };
    }
    case "by-program": {
      const rows = await prisma.contribution.findMany({
        where: baseWhere,
        select: { amount: true, refundedAmount: true, contributionProgram: { select: { name: true } } },
      });
      const byProgram = new Map<string, { total: number; count: number }>();
      for (const row of rows) {
        const key = row.contributionProgram?.name ?? "(no program)";
        const bucket = byProgram.get(key) ?? { total: 0, count: 0 };
        bucket.total += effective(row.amount, row.refundedAmount);
        bucket.count += 1;
        byProgram.set(key, bucket);
      }
      return {
        type,
        columns: ["Program", "Contributions", "Net amount"],
        rows: [...byProgram.entries()].sort((a, b) => b[1].total - a[1].total).map(([program, bucket]) => [program, bucket.count, money(bucket.total)]),
      };
    }
    case "methods": {
      const rows = await prisma.contribution.findMany({
        where: baseWhere,
        select: { amount: true, refundedAmount: true, paymentMethod: true },
      });
      const byMethod = new Map<string, { total: number; count: number }>();
      for (const row of rows) {
        const key = row.paymentMethod ?? "(unknown)";
        const bucket = byMethod.get(key) ?? { total: 0, count: 0 };
        bucket.total += effective(row.amount, row.refundedAmount);
        bucket.count += 1;
        byMethod.set(key, bucket);
      }
      return {
        type,
        columns: ["Method", "Contributions", "Net amount"],
        rows: [...byMethod.entries()].sort((a, b) => b[1].total - a[1].total).map(([method, bucket]) => [method, bucket.count, money(bucket.total)]),
      };
    }
    case "recurring": {
      const schedules = await prisma.recurringContributionSchedule.findMany({
        where: { organizationId, status: { in: ["ACTIVE", "PAUSED", "PAYMENT_FAILED", "PAYMENT_ACTION_REQUIRED"] } },
        include: { fund: { select: { name: true } }, contributorUser: { select: { displayName: true, email: true } } },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      return {
        type,
        columns: ["Contributor", "Fund", "Amount", "Frequency", "Monthly run rate", "Status", "Next contribution"],
        rows: schedules.map((schedule) => [
          schedule.contributorUser.displayName || schedule.contributorUser.email || "—",
          schedule.fund.name,
          money(Number(schedule.amount)),
          schedule.frequency,
          money(monthlyRunRate(Number(schedule.amount), schedule.frequency)),
          schedule.status,
          schedule.nextContributionDate?.toISOString().slice(0, 10) ?? "—",
        ]),
      };
    }
    case "pledge-progress": {
      const { listPledges } = await import("./pledges");
      const pledges = await listPledges(organizationId);
      return {
        type,
        columns: ["Contributor", "Fund", "Campaign", "Pledged", "Contributed", "Remaining toward pledge", "Status"],
        rows: pledges.map((pledge) => [
          pledge.contributor ?? "—",
          pledge.fundName,
          pledge.campaignName ?? "—",
          money(pledge.pledged),
          money(pledge.contributed),
          money(Math.max(0, pledge.pledged - pledge.contributed)),
          pledge.status,
        ]),
      };
    }
    case "failures": {
      const schedules = await prisma.recurringContributionSchedule.findMany({
        where: { organizationId, status: { in: ["PAYMENT_FAILED", "PAYMENT_ACTION_REQUIRED"] } },
        include: { fund: { select: { name: true } }, contributorUser: { select: { displayName: true, email: true } } },
        orderBy: { updatedAt: "desc" },
        take: 500,
      });
      return {
        type,
        columns: ["Contributor", "Fund", "Amount", "Status", "Last update"],
        rows: schedules.map((schedule) => [
          schedule.contributorUser.displayName || schedule.contributorUser.email || "—",
          schedule.fund.name,
          money(Number(schedule.amount)),
          schedule.status,
          schedule.updatedAt.toISOString().slice(0, 10),
        ]),
      };
    }
    case "refunds": {
      const rows = await prisma.contribution.findMany({
        where: {
          organizationId,
          refundedAt: { gte: range.from, lt: range.to },
          ...(options.fundId ? { fundId: options.fundId } : {}),
        },
        include: { fund: { select: { name: true } }, member: { select: { firstName: true, lastName: true } } },
        orderBy: { refundedAt: "desc" },
        take: 500,
      });
      return {
        type,
        columns: ["Number", "Date refunded", "Attribution", "Fund", "Original", "Refunded", "Reason"],
        rows: rows.map((row) => [
          row.contributionNumber ?? "—",
          row.refundedAt?.toISOString().slice(0, 10) ?? "—",
          row.member ? `${row.member.firstName} ${row.member.lastName}`.trim() : (row.contributorName ?? "—"),
          row.fund?.name ?? "—",
          money(Number(row.amount)),
          money(Number(row.refundedAmount ?? 0)),
          row.refundReason ?? "—",
        ]),
      };
    }
    case "offline": {
      const rows = await prisma.contribution.findMany({
        where: { ...baseWhere, source: { in: ["MANUAL", "IMPORT"] } },
        include: { fund: { select: { name: true } }, member: { select: { firstName: true, lastName: true } } },
        orderBy: { contributionDate: "desc" },
        take: 500,
      });
      return {
        type,
        columns: ["Number", "Date", "Attribution", "Fund", "Method", "Amount"],
        rows: rows.map((row) => [
          row.contributionNumber ?? "—",
          row.contributionDate.toISOString().slice(0, 10),
          row.anonymityMode === "PUBLICLY_ANONYMOUS" ? "(anonymous)" : row.member ? `${row.member.firstName} ${row.member.lastName}`.trim() : (row.contributorName ?? "—"),
          row.fund?.name ?? "—",
          row.paymentMethod ?? "—",
          money(effective(row.amount, row.refundedAmount)),
        ]),
      };
    }
    case "year-over-year": {
      const thisYear = range.to.getUTCFullYear() - 1 >= range.from.getUTCFullYear() ? range.to.getUTCFullYear() : range.from.getUTCFullYear();
      const years = [thisYear - 2, thisYear - 1, thisYear];
      const rows: (string | number)[][] = [];
      for (const year of years) {
        const agg = await prisma.contribution.findMany({
          where: {
            organizationId,
            voidedAt: null,
            contributionDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
            ...(options.fundId ? { fundId: options.fundId } : {}),
          },
          select: { amount: true, refundedAmount: true },
        });
        rows.push([String(year), agg.length, money(agg.reduce((sum, row) => sum + effective(row.amount, row.refundedAmount), 0))]);
      }
      return { type, columns: ["Year", "Contributions", "Net amount"], rows };
    }
    default:
      throw new FinanceError("Unknown report type.");
  }
}

/** §53 — CSV of exactly the displayed columns, nothing else. */
export function reportToCsv(report: ReportResult): string {
  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [report.columns.map(escape).join(","), ...report.rows.map((row) => row.map(escape).join(","))].join("\n");
}
