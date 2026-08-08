import { prisma } from "@/lib/prisma";

/**
 * Shared "safe" financial summary — mirrors the main org dashboard's own
 * technique (src/app/(portal)/dashboard/page.tsx) exactly: every total is
 * computed via a DB-side Decimal SUM() (Postgres aggregate, not a JS
 * reduce over floats), converted to integer CENTS exactly once per
 * aggregate, then combined using only integer arithmetic. This is
 * deliberately NOT the GENERAL_FINANCIAL report type's technique (a plain
 * `.reduce((sum, row) => sum + Number(row.amount), 0)` over fetched rows),
 * which is float-summation-error-prone — see docs/reports for why.
 *
 * Scoped to dues + contributions only (member-payments administration).
 * Expenditures/ledger are deliberately excluded — out of scope for the
 * Mobile Admin Payments program (PR D); see program notes for why.
 */

export interface MemberPaymentsFinancialSummary {
  /** All-time DuesPayment total. */
  totalDuesCollectedCents: number;
  /** All-time Contribution total (voided contributions excluded). */
  totalContributionsCents: number;
  /** Sum of (amountDue - amountPaid) across PENDING/PARTIAL DuesCharge rows. */
  duesOutstandingCents: number;
  /** DuesPayment total from the trailing 30 days (server-local time, matching the dashboard). */
  duesCollected30dCents: number;
}

export async function getMemberPaymentsFinancialSummary(organizationId: string): Promise<MemberPaymentsFinancialSummary> {
  const last30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [duesOutstanding, duesCollected30d, duesTotal, contributionsTotal] = await Promise.all([
    prisma.duesCharge.aggregate({
      where: { organizationId, status: { in: ["PENDING", "PARTIAL"] } },
      _sum: { amountDue: true, amountPaid: true },
    }),
    prisma.duesPayment.aggregate({
      where: { organizationId, paymentDate: { gte: last30 } },
      _sum: { amount: true },
    }),
    prisma.duesPayment.aggregate({
      where: { organizationId },
      _sum: { amount: true },
    }),
    prisma.contribution.aggregate({
      where: { organizationId, voidedAt: null },
      _sum: { amount: true },
    }),
  ]);

  return {
    totalDuesCollectedCents: Math.round(Number(duesTotal._sum.amount || 0) * 100),
    totalContributionsCents: Math.round(Number(contributionsTotal._sum.amount || 0) * 100),
    duesOutstandingCents: Math.round((Number(duesOutstanding._sum.amountDue || 0) - Number(duesOutstanding._sum.amountPaid || 0)) * 100),
    duesCollected30dCents: Math.round(Number(duesCollected30d._sum.amount || 0) * 100),
  };
}
