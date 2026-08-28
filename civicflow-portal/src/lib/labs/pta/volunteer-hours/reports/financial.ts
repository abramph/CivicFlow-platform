import { prisma } from "@/lib/prisma";
import { buildReportInfo, emptySummaryTotals, STANDARD_CALCULATION_NOTES } from "./shared";
import type { ReportColumn } from "./xlsx-builder";
import type { ReportData, VolunteerReportFilters } from "./types";

export type FinancialTransactionType = "BUYOUT_PURCHASE" | "ASSESSMENT_CHARGE";

export interface FinancialTransactionRow {
  transactionId: string;
  transactionType: FinancialTransactionType;
  householdId: string;
  householdDisplayName: string;
  transactionDate: Date;
  description: string;
  hoursMinutes: number | null;
  rateType: string | null;
  baseAmountCents: number;
  coverageAmountCents: number;
  totalAmountCents: number;
  amountPaidCents: number;
  refundedCents: number;
  outstandingCents: number;
  paymentMethod: string;
  status: string;
  recordedByName: string | null;
}

/**
 * Report E: Purchased-Hours & Financial Report (spec §11) — the one report
 * in this program gated on pta:volunteer-financial-reports:view rather than
 * the general reports permission. Reconciles every real money movement this
 * feature can produce — buyout purchases and remaining-hours assessment
 * charges — into a single transaction-level view, so a treasurer never has
 * to cross-reference two separate screens to reconcile a period's revenue.
 */
export async function buildFinancialReportData(
  organizationId: string,
  filters: VolunteerReportFilters,
  generatedByName: string
): Promise<ReportData<FinancialTransactionRow>> {
  const [purchases, charges] = await Promise.all([
    prisma.ptaVolunteerBuyoutPurchase.findMany({
      where: {
        organizationId,
        requirementPeriodId: filters.requirementPeriodId,
        householdId: filters.householdId ? filters.householdId : undefined,
        status: { in: ["COMPLETED", "REFUNDED"] },
      },
    }),
    prisma.ptaVolunteerAssessmentCharge.findMany({
      where: {
        organizationId,
        requirementPeriodId: filters.requirementPeriodId,
        householdId: filters.householdId ? filters.householdId : undefined,
        status: { not: "VOID" },
      },
      include: { line: true },
    }),
  ]);

  const householdIds = [...new Set([...purchases.map((p) => p.householdId), ...charges.map((c) => c.householdId)])];
  const recordedByIds = [
    ...new Set([...purchases.map((p) => p.recordedByUserId), ...charges.map((c) => c.recordedByUserId)].filter((id): id is string => !!id)),
  ];
  const [households, recorders] = await Promise.all([
    prisma.ptaHousehold.findMany({ where: { id: { in: householdIds } }, select: { id: true, displayName: true } }),
    recordedByIds.length > 0 ? prisma.user.findMany({ where: { id: { in: recordedByIds } }, select: { id: true, displayName: true, email: true } }) : Promise.resolve([]),
  ]);
  const householdById = new Map(households.map((h) => [h.id, h.displayName]));
  const recorderById = new Map(recorders.map((u) => [u.id, u.displayName || u.email]));

  const rows: FinancialTransactionRow[] = [];

  for (const p of purchases) {
    const date = p.completedAt ?? p.createdAt;
    if (filters.dateRangeStart && date < filters.dateRangeStart) continue;
    if (filters.dateRangeEnd && date > filters.dateRangeEnd) continue;
    const paidCents = p.totalCents - p.refundedAmountCents;
    rows.push({
      transactionId: p.id,
      transactionType: "BUYOUT_PURCHASE",
      householdId: p.householdId,
      householdDisplayName: householdById.get(p.householdId) ?? "",
      transactionDate: date,
      description: `${p.electionType === "FULL_BUYOUT" ? "Full" : "Partial"} volunteer-hour buyout`,
      hoursMinutes: p.hoursElectedMinutes,
      rateType: p.rateType,
      baseAmountCents: p.baseAmountCents,
      coverageAmountCents: p.coverageAmountCents,
      totalAmountCents: p.totalCents,
      amountPaidCents: paidCents,
      refundedCents: p.refundedAmountCents,
      outstandingCents: 0,
      paymentMethod: p.paymentMethod,
      status: p.status,
      recordedByName: p.recordedByUserId ? (recorderById.get(p.recordedByUserId) ?? p.recordedByUserId) : null,
    });
  }

  for (const c of charges) {
    const date = c.paidAt ?? c.createdAt;
    if (filters.dateRangeStart && date < filters.dateRangeStart) continue;
    if (filters.dateRangeEnd && date > filters.dateRangeEnd) continue;
    const outstanding = Math.max(0, c.amountCents - c.amountPaidCents - c.refundedCents);
    rows.push({
      transactionId: c.id,
      transactionType: "ASSESSMENT_CHARGE",
      householdId: c.householdId,
      householdDisplayName: householdById.get(c.householdId) ?? "",
      transactionDate: date,
      description: "Remaining-hours assessment",
      hoursMinutes: c.line?.remainingMinutes ?? null,
      rateType: null,
      baseAmountCents: c.amountCents,
      coverageAmountCents: 0,
      totalAmountCents: c.amountCents,
      amountPaidCents: c.amountPaidCents,
      refundedCents: c.refundedCents,
      outstandingCents: outstanding,
      paymentMethod: c.paymentMethod ?? "UNPAID",
      status: c.status,
      recordedByName: c.recordedByUserId ? (recorderById.get(c.recordedByUserId) ?? c.recordedByUserId) : null,
    });
  }

  if (filters.paymentStatus) {
    const wanted = filters.paymentStatus;
    rows.splice(
      0,
      rows.length,
      ...rows.filter((r) => r.status === wanted)
    );
  }

  rows.sort((a, b) => b.transactionDate.getTime() - a.transactionDate.getTime());

  const summary = emptySummaryTotals();
  summary.totalFamilies = new Set(rows.map((r) => r.householdId)).size;
  for (const row of rows) {
    if (row.transactionType === "BUYOUT_PURCHASE") {
      summary.totalBuyoutRevenueCents += row.amountPaidCents;
      summary.totalPurchasedMinutes += row.hoursMinutes ?? 0;
    } else {
      summary.totalAssessmentsCents += row.totalAmountCents;
      summary.outstandingBalanceCents += row.outstandingCents;
    }
  }

  const info = await buildReportInfo(organizationId, filters, "Purchased-Hours & Financial Report", generatedByName, [
    ...STANDARD_CALCULATION_NOTES,
    "Includes completed and refunded buyout purchases and all non-void assessment charges. Void or pending/failed (never-completed) transactions are excluded.",
  ]);
  return { info, summary, rows };
}

export const FINANCIAL_COLUMNS: ReportColumn<FinancialTransactionRow>[] = [
  { header: "Family", format: "text", width: 24, getValue: (r) => r.householdDisplayName },
  { header: "Transaction type", format: "text", width: 18, getValue: (r) => r.transactionType },
  { header: "Date", format: "date", width: 12, getValue: (r) => r.transactionDate },
  { header: "Description", format: "text", width: 26, getValue: (r) => r.description },
  { header: "Hours", format: "hours", width: 10, getValue: (r) => r.hoursMinutes },
  { header: "Rate type", format: "text", width: 14, getValue: (r) => r.rateType },
  { header: "Base amount", format: "currency", width: 12, getValue: (r) => r.baseAmountCents },
  { header: "Coverage amount", format: "currency", width: 14, getValue: (r) => r.coverageAmountCents },
  { header: "Total amount", format: "currency", width: 12, getValue: (r) => r.totalAmountCents },
  { header: "Amount paid", format: "currency", width: 12, getValue: (r) => r.amountPaidCents },
  { header: "Refunded", format: "currency", width: 12, getValue: (r) => r.refundedCents },
  { header: "Outstanding", format: "currency", width: 12, getValue: (r) => r.outstandingCents },
  { header: "Payment method", format: "text", width: 14, getValue: (r) => r.paymentMethod },
  { header: "Status", format: "text", width: 12, getValue: (r) => r.status },
  { header: "Recorded by", format: "text", width: 18, getValue: (r) => r.recordedByName },
];
